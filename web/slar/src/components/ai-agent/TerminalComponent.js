"use client";

import { useEffect, useRef, useState } from 'react';

const TerminalComponent = ({ sessionId }) => {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    // Dynamically import xterm only on client side
    let mounted = true;

    const initTerminal = async () => {
      try {
        // Import xterm modules (new @xterm scope)
        const { Terminal } = await import('@xterm/xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        const { WebLinksAddon } = await import('@xterm/addon-web-links');
        
        // Import xterm CSS
        await import('@xterm/xterm/css/xterm.css');

        if (!mounted || !terminalRef.current) return;

        // Create terminal instance
        const term = new Terminal({
          cursorBlink: true,
          convertEol: true,
          fontSize: 14,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          allowProposedApi: true, // Enable all features including 24-bit color
          theme: {
            background: '#0b0b0b',
            foreground: '#e6e6e6',
            cursor: '#e6e6e6',
            black: '#000000',
            red: '#cd3131',
            green: '#0dbc79',
            yellow: '#e5e510',
            blue: '#2472c8',
            magenta: '#bc3fbc',
            cyan: '#11a8cd',
            white: '#e5e5e5',
            brightBlack: '#666666',
            brightRed: '#f14c4c',
            brightGreen: '#23d18b',
            brightYellow: '#f5f543',
            brightBlue: '#3b8eea',
            brightMagenta: '#d670d6',
            brightCyan: '#29b8db',
            brightWhite: '#e5e5e5',
          }
        });

        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon();
        
        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);
        
        term.open(terminalRef.current);

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        // Fit terminal to container
        const fitAndResizeNotify = () => {
          try {
            fitAddon.fit();
          } catch (e) {
            console.error('Fit error:', e);
          }
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ 
              resize: [term.cols, term.rows] 
            }));
          }
        };

        // Initial fit
        setTimeout(() => fitAndResizeNotify(), 100);

        // Handle window resize
        const handleResize = () => {
          setTimeout(() => fitAndResizeNotify(), 50);
        };
        window.addEventListener('resize', handleResize);

        let wsUrl;
        // Setup WebSocket connection
        // Connect to standalone Terminal Server (port 8003)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        if (process.env.NEXT_PUBLIC_TERMINAL_HOST) {
          wsUrl = process.env.NEXT_PUBLIC_TERMINAL_HOST+'?session_id='+sessionId;
        } else {
          wsUrl = `${protocol}//${window.location.host}/ws/terminal?session_id=${sessionId}`;
        }

        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        ws.addEventListener('open', () => {
          setStatus('connected');
          term.focus();
          fitAndResizeNotify();
          
          // Send GEMINI_API_KEY from sessionStorage if available
          const geminiKey = sessionStorage.getItem('GEMINI_API_KEY');
          if (geminiKey) {
            // Send as environment variable setup
            ws.send(JSON.stringify({ 
              env: { GEMINI_API_KEY: geminiKey }
            }));
          }
        });

        ws.addEventListener('close', () => {
          setStatus('closed');
        });

        ws.addEventListener('error', (err) => {
          console.error('WebSocket error:', err);
          setStatus('error');
        });

        ws.addEventListener('message', (ev) => {
          if (ev.data instanceof ArrayBuffer) {
            const text = new TextDecoder().decode(new Uint8Array(ev.data));
            term.write(text);
          } else if (typeof ev.data === 'string') {
            term.write(ev.data);
          }
        });

        // Send data to WebSocket
        term.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(new TextEncoder().encode(data));
          }
        });

        // Cleanup function
        return () => {
          mounted = false;
          window.removeEventListener('resize', handleResize);
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
          }
          if (term) {
            term.dispose();
          }
        };
      } catch (error) {
        console.error('Failed to initialize terminal:', error);
        setStatus('error');
      }
    };

    const cleanup = initTerminal();

    return () => {
      mounted = false;
      if (cleanup && typeof cleanup.then === 'function') {
        cleanup.then(fn => fn && fn());
      }
    };
  }, [sessionId]);

  const handleFocus = () => {
    if (xtermRef.current) {
      xtermRef.current.focus();
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Status Bar - Responsive for mobile */}
      <div className="flex items-center justify-between px-2 sm:px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-xs sm:text-sm text-gray-400 whitespace-nowrap">
            <span className="hidden sm:inline">Terminal Status: </span>
            <span className="sm:hidden">Status: </span>
          </span>
          <span className={`text-xs sm:text-sm font-medium ${
            status === 'connected' ? 'text-green-400' :
            status === 'connecting' ? 'text-yellow-400' :
            status === 'error' ? 'text-red-400' :
            'text-gray-400'
          }`}>
            {status === 'connected' ? 'Connected' :
             status === 'connecting' ? 'Connecting...' :
             status === 'error' ? 'Error' :
             'Disconnected'}
          </span>
        </div>
        <button
          onClick={handleFocus}
          className="px-2 sm:px-3 py-1 text-xs sm:text-sm text-gray-300 bg-gray-700 border border-gray-600 rounded hover:bg-gray-600 transition-colors whitespace-nowrap"
        >
          <span className="hidden sm:inline">Focus Terminal</span>
          <span className="sm:hidden">Focus</span>
        </button>
      </div>

      {/* Terminal Container - Full height on mobile */}
      <div 
        ref={terminalRef}
        onClick={handleFocus}
        className="flex-1 p-2 overflow-hidden cursor-text"
      />
    </div>
  );
};

export default TerminalComponent;

