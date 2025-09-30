#!/usr/bin/env node

/**
 * Test script for Perplexity Search MCP Server
 * Tests the perplexity-search tool with a sample query
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Start the MCP server
const serverPath = join(__dirname, 'dist', 'index.js');
const server = spawn('node', ['-r', 'dotenv/config', serverPath, 'dotenv_config_path=.env.local'], {
  stdio: ['pipe', 'pipe', 'inherit']
});

let buffer = '';

server.stdout.on('data', (data) => {
  buffer += data.toString();

  // Try to parse complete JSON messages
  const lines = buffer.split('\n');
  buffer = lines.pop(); // Keep incomplete line in buffer

  lines.forEach(line => {
    if (line.trim()) {
      try {
        const response = JSON.parse(line);
        console.log('\n=== MCP Server Response ===');
        console.log(JSON.stringify(response, null, 2));

        if (response.id === 2) {
          // Got the search result, exit
          setTimeout(() => {
            server.kill();
            process.exit(0);
          }, 100);
        }
      } catch (e) {
        console.log('Raw output:', line);
      }
    }
  });
});

server.on('error', (err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// Wait for server to initialize
setTimeout(() => {
  console.log('=== Calling perplexity-search tool ===');
  console.log('Query: "catswithbats"\n');

  // Send tool call request
  const request = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'perplexity-search',
      arguments: {
        query: 'catswithbats',
        max_results: 5
      }
    }
  };

  server.stdin.write(JSON.stringify(request) + '\n');
}, 1000);

// Timeout after 30 seconds
setTimeout(() => {
  console.error('\nTimeout - no response received');
  server.kill();
  process.exit(1);
}, 30000);
