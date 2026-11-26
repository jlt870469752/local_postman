use socket2::{Domain, Protocol, Socket, Type};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};

pub fn bind(port: u16) -> Result<TcpListener, String> {
    let socket = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP))
        .map_err(|e| e.to_string())?;
    // Rebind after accepted connections enter TIME_WAIT, without permitting
    // simultaneous listeners (SO_REUSEPORT remains disabled).
    #[cfg(unix)]
    socket.set_reuse_address(true).map_err(|e| e.to_string())?;
    socket.bind(&SocketAddrV4::new(Ipv4Addr::LOCALHOST, port).into())
        .map_err(|e| e.to_string())?;
    socket.listen(128).map_err(|e| e.to_string())?;
    Ok(socket.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    #[test]
    fn repeated_restarts_reuse_closed_connections_without_sharing_live_ports() {
        let _guard = crate::NETWORK_TEST_LOCK.lock().unwrap_or_else(|e|e.into_inner());
        let mut port = 0;
        for cycle in 0..20 {
            let listener = bind(port).unwrap_or_else(|error|panic!("restart cycle {cycle}, port {port}: {error}"));
            port = listener.local_addr().unwrap().port();
            assert!(bind(port).is_err(), "A second live listener must be rejected");
            let client = std::thread::spawn(move || {
                let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
                let mut bytes = Vec::new();stream.read_to_end(&mut bytes).unwrap();
                assert_eq!(bytes, b"ok");
            });
            let (mut stream, _) = listener.accept().unwrap();
            stream.write_all(b"ok").unwrap();drop(stream);client.join().unwrap();drop(listener);
        }
    }
}
