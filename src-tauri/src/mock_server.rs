use serde::{Deserialize, Serialize};
use std::{collections::{HashMap, VecDeque}, io::{Read, Write}, net::TcpStream, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::Duration};
#[derive(Clone, Deserialize)]
pub struct MockRoute { pub method:String,pub path:String,pub status:u16,pub body:String,#[serde(default)] pub headers:HashMap<String,String>,#[serde(default)] pub delay_ms:u64 }
#[derive(Clone, Deserialize)]
pub struct MockConfig {pub id:String,pub port:u16,pub routes:Vec<MockRoute>}
#[derive(Clone, Serialize)]
pub struct MockLog {pub method:String,pub path:String,pub status:u16,pub at:u64}
#[derive(Clone, Serialize)]
pub struct MockInfo {pub id:String,pub port:u16,pub logs:Vec<MockLog>}
struct Running {port:u16,stop:Arc<AtomicBool>,logs:Arc<Mutex<VecDeque<MockLog>>>,thread:Option<std::thread::JoinHandle<()>>}
impl Running {fn stop(&mut self){self.stop.store(true,Ordering::Relaxed);if let Some(thread)=self.thread.take(){let _=thread.join();}}}
#[derive(Default)]pub struct MockRegistry(Mutex<HashMap<String,Running>>);
impl Drop for MockRegistry {fn drop(&mut self){if let Ok(mut map)=self.0.lock(){for server in map.values_mut(){server.stop();}}}}
fn handle(mut stream:TcpStream,routes:&[MockRoute],logs:&Mutex<VecDeque<MockLog>>){
 let _=stream.set_nonblocking(false);let _=stream.set_read_timeout(Some(Duration::from_secs(2)));let mut bytes=Vec::new();let mut buf=[0u8;4096];
 loop {match stream.read(&mut buf){Ok(0)|Err(_)=>return,Ok(n)=>bytes.extend_from_slice(&buf[..n])}if bytes.windows(4).any(|w|w==b"\r\n\r\n"){break}if bytes.len()>65536{return}}
 let head=String::from_utf8_lossy(&bytes);let mut line=head.lines().next().unwrap_or("").split_whitespace();let method=line.next().unwrap_or("").to_owned();let path=line.next().unwrap_or("/").to_owned();
 let request_path=path.split('?').next().unwrap_or("/");
 let matched=routes.iter().find(|r|r.method.eq_ignore_ascii_case(&method)&&r.path==request_path).or_else(||routes.iter().find(|r|r.method=="*"&&r.path==request_path));
 // Explicit OPTIONS routes keep their configured response. Other OPTIONS requests
 // receive a local CORS preflight response, including when only a wildcard exists.
 let explicit_options=routes.iter().find(|r|r.method.eq_ignore_ascii_case("OPTIONS")&&r.path==request_path);
 let preflight=method.eq_ignore_ascii_case("OPTIONS")&&explicit_options.is_none();
 let(status,body,mut headers,delay)=if preflight{(204,String::new(),HashMap::new(),0)}else{match matched{Some(r)=>(r.status,r.body.clone(),r.headers.clone(),r.delay_ms),None=>(404,"{\"error\":\"No matching mock route\"}".into(),HashMap::new(),0)}};
 let mut add_header=|name:&str,value:String|{if !headers.keys().any(|k|k.eq_ignore_ascii_case(name)){headers.insert(name.into(),value);}};
 // Local Mock endpoints are intended for browser frontend development too. Keep
 // explicitly configured CORS headers and use non-credentialed defaults otherwise.
 add_header("Access-Control-Allow-Origin","*".into());
 add_header("Access-Control-Expose-Headers","*".into());
 if method.eq_ignore_ascii_case("OPTIONS"){
  let mut methods:Vec<String>=routes.iter().filter(|r|r.path==request_path).flat_map(|r|if r.method=="*"{vec!["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"].into_iter().map(String::from).collect()}else{vec![r.method.to_ascii_uppercase()]}).collect();
  methods.push("OPTIONS".into());methods.sort();methods.dedup();
  add_header("Access-Control-Allow-Methods",methods.join(", "));
  let requested_headers=head.lines().skip(1).filter_map(|line|line.split_once(':')).find(|(key,_)|key.eq_ignore_ascii_case("access-control-request-headers")).map(|(_,value)|value.trim()).filter(|value|value.split(',').all(|name|reqwest::header::HeaderName::from_bytes(name.trim().as_bytes()).is_ok())).unwrap_or("Content-Type, Authorization");
  add_header("Access-Control-Allow-Headers",requested_headers.into());
  add_header("Access-Control-Max-Age","600".into());
 }
 if delay>0{std::thread::sleep(Duration::from_millis(delay.min(30000)))}
 let mut response=format!("HTTP/1.1 {status} {}\r\nContent-Length: {}\r\nConnection: close\r\n",if status<400{"OK"}else{"Error"},body.len());
 if !headers.keys().any(|k|k.eq_ignore_ascii_case("content-type")){response.push_str("Content-Type: application/json\r\n")}
 for(k,v)in headers{if !k.contains(['\r','\n'])&&!v.contains(['\r','\n'])&&!k.eq_ignore_ascii_case("content-length")&&!k.eq_ignore_ascii_case("connection"){response.push_str(&format!("{k}: {v}\r\n"))}}
 response.push_str("\r\n");if method!="HEAD"{response.push_str(&body)}let _=stream.write_all(response.as_bytes());
 if let Ok(mut entries)=logs.lock(){entries.push_front(MockLog{method,path,status,at:std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64});entries.truncate(100);}
}
impl MockRegistry {
 pub fn start(&self,config:MockConfig)->Result<MockInfo,String>{
  let mut keys=std::collections::HashSet::new();
  for r in &config.routes{
   if !(100..=599).contains(&r.status)||!r.path.starts_with('/')||r.path.contains(['?', '#', '\r', '\n', ' '])||!(r.method=="*"||r.method.parse::<reqwest::Method>().is_ok()){return Err("Routes need an HTTP method, absolute path without query/fragment, and status from 100 to 599".into())}
   if !keys.insert((r.method.to_ascii_uppercase(),r.path.clone())){return Err(format!("Duplicate mock route: {} {}",r.method,r.path))}
  }
  let mut map=self.0.lock().map_err(|e|e.to_string())?;if map.contains_key(&config.id){return Err("Stop this mock server before changing its configuration".into())}
  let listener=crate::local_listener::bind(config.port)?;listener.set_nonblocking(true).map_err(|e|e.to_string())?;let port=listener.local_addr().map_err(|e|e.to_string())?.port();let stop=Arc::new(AtomicBool::new(false));let logs=Arc::new(Mutex::new(VecDeque::new()));
  let(stop_thread,logs_thread)=(stop.clone(),logs.clone());let routes=Arc::new(config.routes);let thread=std::thread::spawn(move||{while !stop_thread.load(Ordering::Relaxed){match listener.accept(){Ok((stream,_))=>{let routes=routes.clone();let log=logs_thread.clone();std::thread::spawn(move||handle(stream,&routes,&log));},Err(e)if e.kind()==std::io::ErrorKind::WouldBlock=>std::thread::sleep(Duration::from_millis(20)),Err(_)=>break}}});
  map.insert(config.id.clone(),Running{port,stop,logs,thread:Some(thread)});Ok(MockInfo{id:config.id,port,logs:vec![]})
 }
 pub fn stop(&self,id:&str)->Result<(),String>{if let Some(mut server)=self.0.lock().map_err(|e|e.to_string())?.remove(id){server.stop();}Ok(())}
 pub fn info(&self)->Result<Vec<MockInfo>,String>{self.0.lock().map_err(|e|e.to_string())?.iter().map(|(id,r)|Ok(MockInfo{id:id.clone(),port:r.port,logs:r.logs.lock().map_err(|e|e.to_string())?.iter().cloned().collect()})).collect()}
}
#[tauri::command]pub fn mock_start(config:MockConfig,registry:tauri::State<'_,MockRegistry>)->Result<MockInfo,String>{registry.start(config)}
#[tauri::command]pub fn mock_stop(id:String,registry:tauri::State<'_,MockRegistry>)->Result<(),String>{registry.stop(&id)}
#[tauri::command]pub fn mock_status(registry:tauri::State<'_,MockRegistry>)->Result<Vec<MockInfo>,String>{registry.info()}
#[cfg(test)]
mod tests {
 use super::*;
 fn route(method:&str,path:&str,status:u16,body:&str)->MockRoute{MockRoute{method:method.into(),path:path.into(),status,body:body.into(),headers:HashMap::from([("X-Mock-Route".into(),path.into())]),delay_ms:0}}
 fn call(port:u16,method:&str,path:&str)->String {
  let mut stream=TcpStream::connect(("127.0.0.1",port)).unwrap();
  stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
  write!(stream,"{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").unwrap();
  let mut response=String::new();stream.read_to_string(&mut response).unwrap();response
 }
 #[test]fn multiple_routes_keep_independent_methods_headers_and_bodies(){
  let _network_guard=crate::NETWORK_TEST_LOCK.lock().unwrap_or_else(|e|e.into_inner());
  let registry=MockRegistry::default();
  let server=registry.start(MockConfig{id:"test".into(),port:0,routes:vec![route("GET","/users",200,"[{\"id\":1}]"),route("POST","/users",201,"{\"created\":true}"),route("GET","/health",204,"")]}).unwrap();
  let users=call(server.port,"GET","/users?page=1");assert!(users.starts_with("HTTP/1.1 200"));assert!(users.ends_with("[{\"id\":1}]"));assert!(users.contains("X-Mock-Route: /users"));
  let created=call(server.port,"POST","/users");assert!(created.starts_with("HTTP/1.1 201"));assert!(created.ends_with("{\"created\":true}"));
  let health=call(server.port,"GET","/health");assert!(health.starts_with("HTTP/1.1 204"));assert!(health.ends_with("\r\n\r\n"));
  assert!(call(server.port,"DELETE","/users").starts_with("HTTP/1.1 404"));
  registry.stop("test").unwrap();assert!(registry.info().unwrap().is_empty());
  // Restarting the same port must apply changed routes immediately.
  let restarted=registry.start(MockConfig{id:"test".into(),port:server.port,routes:vec![route("GET","/users",202,"updated")]}).unwrap();
  assert!(call(restarted.port,"GET","/users").ends_with("updated"));
  registry.stop("test").unwrap();assert!(TcpStream::connect(("127.0.0.1",server.port)).is_err(),"stop must remove the listener");
 }
 #[test]fn browser_preflight_and_error_responses_have_cors_headers(){
  let _network_guard=crate::NETWORK_TEST_LOCK.lock().unwrap_or_else(|e|e.into_inner());
  let registry=MockRegistry::default();
  let server=registry.start(MockConfig{id:"cors".into(),port:0,routes:vec![route("POST","/users",201,"created")]}).unwrap();
  let mut stream=TcpStream::connect(("127.0.0.1",server.port)).unwrap();
  write!(stream,"OPTIONS /users HTTP/1.1\r\nHost: localhost\r\nOrigin: http://localhost:5173\r\nAccess-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: content-type, x-request-id\r\nConnection: close\r\n\r\n").unwrap();
  let mut response=String::new();stream.read_to_string(&mut response).unwrap();
  assert!(response.starts_with("HTTP/1.1 204"));assert!(response.ends_with("\r\n\r\n"));
  assert!(response.contains("Access-Control-Allow-Origin: *"));
  assert!(response.contains("Access-Control-Allow-Methods: OPTIONS, POST"));
  assert!(response.contains("Access-Control-Allow-Headers: content-type, x-request-id"));
  assert!(call(server.port,"POST","/users").contains("Access-Control-Allow-Origin: *"));
  assert!(call(server.port,"GET","/missing").contains("Access-Control-Allow-Origin: *"));
  registry.stop("cors").unwrap();
 }
 #[test]fn configured_options_and_cors_headers_override_defaults(){
  let _network_guard=crate::NETWORK_TEST_LOCK.lock().unwrap_or_else(|e|e.into_inner());
  let registry=MockRegistry::default();let mut configured=route("OPTIONS","/users",202,"custom options");
  configured.headers.insert("access-control-allow-origin".into(),"http://localhost:5173".into());
  configured.headers.insert("Access-Control-Allow-Headers".into(),"X-Only".into());
  let server=registry.start(MockConfig{id:"cors-options".into(),port:0,routes:vec![configured,route("*","/users",200,"wildcard")]}).unwrap();
  let response=call(server.port,"OPTIONS","/users");assert!(response.starts_with("HTTP/1.1 202"));assert!(response.ends_with("custom options"));
  assert!(response.contains("access-control-allow-origin: http://localhost:5173"));assert!(!response.contains("Access-Control-Allow-Origin: *"));
  assert!(response.contains("Access-Control-Allow-Headers: X-Only"));registry.stop("cors-options").unwrap();
 }

 #[test]fn duplicate_routes_are_rejected_and_exact_methods_override_wildcards(){
  let _network_guard=crate::NETWORK_TEST_LOCK.lock().unwrap_or_else(|e|e.into_inner());
  let registry=MockRegistry::default();
  let result=registry.start(MockConfig{id:"duplicate".into(),port:0,routes:vec![route("GET","/same",200,"one"),route("get","/same",201,"two")]});assert!(matches!(result,Err(message) if message.contains("Duplicate")));
  let server=registry.start(MockConfig{id:"wildcard".into(),port:0,routes:vec![route("*","/same",200,"wildcard"),route("GET","/same",201,"exact")]}).unwrap();
  assert!(call(server.port,"GET","/same").ends_with("exact"));assert!(call(server.port,"POST","/same").ends_with("wildcard"));registry.stop("wildcard").unwrap();
 }
}
