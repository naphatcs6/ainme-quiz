'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

let globalSocket: Socket | null = null;

export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!globalSocket || !globalSocket.connected) {
      globalSocket = io(window.location.origin, {
        transports: ['websocket', 'polling'],
      });
    }
    socketRef.current = globalSocket;

    const onConnect = () => setIsConnected(true);
    const onDisconnect = () => setIsConnected(false);

    globalSocket.on('connect', onConnect);
    globalSocket.on('disconnect', onDisconnect);
    if (globalSocket.connected) setIsConnected(true);

    return () => {
      globalSocket?.off('connect', onConnect);
      globalSocket?.off('disconnect', onDisconnect);
    };
  }, []);

  const emit = useCallback((event: string, ...args: unknown[]) => {
    socketRef.current?.emit(event, ...args);
  }, []);

  const on = useCallback((event: string, fn: (...args: unknown[]) => void) => {
    socketRef.current?.on(event, fn);
    return () => { socketRef.current?.off(event, fn); };
  }, []);

  const off = useCallback((event: string, fn?: (...args: unknown[]) => void) => {
    socketRef.current?.off(event, fn);
  }, []);

  const socketId = socketRef.current?.id;

  return { socket: socketRef.current, isConnected, emit, on, off, socketId };
}
