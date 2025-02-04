<h1 align="center">Live Log Monitor 📜</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-18.x-green?style=for-the-badge" alt="Node Version">
  <img src="https://img.shields.io/badge/WebSockets-RealTime-blue?style=for-the-badge" alt="WebSockets">
  <img src="https://img.shields.io/badge/License-MIT-orange?style=for-the-badge" alt="MIT License">
</p>

<p align="center">
  <i>Continuously monitor a log file in real time over WebSockets</i>
</p>

---

## 🚀 Overview
**Live Log Monitor** is a **Node.js** application that provides a **real-time** view of a growing log file (similar to the Unix `tail -f` command) and streams it to connected clients through **WebSockets**. Simply open the included HTML page in your browser, and any new lines appended to the file on the server side will instantly appear!

---

## 🎉 Features
- **Real-Time Streaming**: Uses WebSockets to deliver newly added lines in the log file immediately to all connected clients.
- **Debounce to Prevent Overload**: Minimizes redundant file-read operations when file updates happen rapidly.
- **Backwards File Reading**: Grabs the last N lines of the file when a new client connects.
- **Auto-Scrolling**: The front-end automatically scrolls to display the most recent lines at the bottom.

---

## 📂 Project Structure

```
.
├── app.js          # Node.js WebSocket server (the backend code)
├── logs.txt           # Sample log file to be monitored
├── index.html         # Basic HTML client to display logs in real-time
├── package.json       # Dependencies and scripts
└── README.md          # You are here!
```

- **server.js**: Contains all the Node.js logic for watching the log file and sending data to the client via WebSockets.
- **logs.txt**: The file you’ll be writing your logs into.
- **index.html**: A simple front-end web page to view your logs as they’re appended.

---

## 🔧 Technologies Used
1. **Node.js**: Server-side JavaScript runtime environment.
2. **WebSocket**: Real-time communication protocol for pushing log updates to the client.
3. **fs (File System)**: Node’s built-in module for file watch and read operations.
4. **HTML & JavaScript**: Basic front-end to display live logs.
5. **CSS**: Optional styling to improve readability.

---

## 📦 Installation & Setup
1. **Clone this repository**:
   ```bash
   git clone https://github.com/rishidyno/tail-f.git
   cd tail-f
   ```
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Check or modify the log file path**:
   - By default, `LOG_FILE_PATH` is set to `logs.txt` in the same directory.
   - You can change it in `app.js` to point to any other file you wish to monitor.

---

## 🚀 Usage
1. **Start the server**:
   ```bash
   node app.js
   ```
   This launches a WebSocket server on **port 8080** (feel free to customize it in the code).

2. **Open the front-end**:
   - Simply open `index.html` in your favorite browser.
   - It will connect automatically to `ws://localhost:8080` and show incoming log lines.

3. **Add data to `logs.txt`**:
   - Whenever you append new lines to `logs.txt`, they’ll instantly appear in the web page’s `<pre>` element.

---

## 🧠 How It Works

1. **File Watching** (`fs.watch`):
   - The server watches the log file and detects any `change` events (new data).
2. **Debounce**:
   - We debounce file reads by 100ms to ensure the server doesn’t repeatedly read on rapid updates.
3. **Reading New Lines**:
   - When a change is detected, the server calculates how many new bytes are added and reads only that portion.
4. **WebSocket Broadcast**:
   - The new lines are sent to all connected clients as a JSON object (e.g., `{ lines: ["new line 1", "new line 2", ...] }`).
5. **Front-End Display**:
   - JavaScript in the browser receives the JSON message, appends new lines to the `<pre>` block, and auto-scrolls to the bottom.

---

## ⚙️ Customization
- **Port**: Modify the `PORT` constant in `app.js`.
- **Last N Lines on Connect**: The `getLastNLines` function retrieves the last 10 lines by default. Change this value as desired.
- **Log File Path**: Edit `LOG_FILE_PATH` in `app.js` to monitor a different file.

---

## 💻 Code Reference

### `server.js` (Backend)

```js
// Import required modules
const fs = require('fs');
const WebSocket = require('ws');
const path = require('path');

// Set the path of the log file to monitor and the WebSocket server's port number
const LOG_FILE_PATH = path.join(__dirname, 'logs.txt');
const PORT = 8080;

// Variable to store the last read position in the file
let lastFileSize = 0;

// Variable to hold a debounce timeout
let debounceTimeout;

// Function to get the last N lines of a file by reading it in reverse
function getLastNLines(filePath, n) {
    return new Promise((resolve, reject) => {
        fs.open(filePath, 'r', (err, fd) => {
            if (err) return reject(err);

            const bufferSize = 1024; // size of each chunk
            const buffer = Buffer.alloc(bufferSize);
            let lines = [];
            let leftover = '';
            let fileSize;

            fs.fstat(fd, (err, stats) => {
                if (err) {
                    fs.close(fd, () => {});
                    return reject(err);
                }

                fileSize = stats.size;
                let position = fileSize;

                function readChunk() {
                    const bytesToRead = Math.min(position, bufferSize);
                    const start = position - bytesToRead;

                    if (bytesToRead <= 0) {
                        if (leftover) {
                            lines.unshift(leftover);
                        }
                        fs.close(fd, () => {});
                        resolve(lines.slice(-n));
                        return;
                    }

                    fs.read(fd, buffer, 0, bytesToRead, start, (err, bytesRead) => {
                        if (err) {
                            fs.close(fd, () => {});
                            return reject(err);
                        }

                        position -= bytesRead;
                        const chunk = buffer.toString('utf-8', 0, bytesRead);
                        const chunkLines = (chunk + leftover).split('\n');

                        leftover = chunkLines.shift();
                        lines = chunkLines.concat(lines);

                        if (lines.length >= n) {
                            fs.close(fd, () => {});
                            resolve(lines.slice(-n));
                            return;
                        }
                        readChunk();
                    });
                }
                readChunk();
            });
        });
    });
}

// Function to read new lines added to the file after the last known position
function getNewLines(filePath, fromPosition) {
    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filePath, {
            encoding: 'utf-8',
            start: fromPosition,
        });

        let data = '';
        stream.on('data', chunk => (data += chunk));
        stream.on('end', () => {
            const lines = data.split('\n').filter(line => line.trim());
            resolve(lines);
        });
        stream.on('error', reject);
    });
}

// Create WebSocket server
const wss = new WebSocket.Server({ port: PORT }, () => {
    console.log(`Websocket server started at ws://localhost:${PORT}`);
});

// On new client connection
wss.on('connection', (ws) => {
    console.log('Client connected');

    // Send the last 10 lines to new clients
    getLastNLines(LOG_FILE_PATH, 10)
        .then((lines) => {
            ws.send(JSON.stringify({ lines }));
        })
        .catch((error) => {
            console.error('Error reading log files:', error);
            ws.send(JSON.stringify({ error: 'Unable to read file' }));
        });

    // Log when the client disconnects
    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// Watch for changes in the log file
fs.watch(LOG_FILE_PATH, async (eventType) => {
    if (eventType === 'change') {
        // Debounce the file read
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(async () => {
            try {
                const stats = await fs.promises.stat(LOG_FILE_PATH);
                if (stats.size > lastFileSize) {
                    const newLines = await getNewLines(LOG_FILE_PATH, lastFileSize);
                    lastFileSize = stats.size;

                    // Broadcast new lines to all connected clients
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ lines: newLines }));
                        }
                    });
                }
            } catch (error) {
                // Handle error (e.g., file missing or inaccessible)
            }
        }, 100);
    }
});

// Initialize the last file size on server startup
fs.promises.stat(LOG_FILE_PATH)
    .then((stats) => {
        lastFileSize = stats.size;
    })
    .catch(() => {
        console.log('Error: Could not read the log file');
        lastFileSize = 0;
    });
```

### `index.html` (Frontend)

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Live Log Monitor</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      padding: 20px;
    }
    #log-container {
      max-width: 800px;
      margin: 0 auto;
      border: 1px solid #ccc;
      padding: 1rem;
      border-radius: 5px;
    }
    #log-content {
      height: 400px;
      overflow-y: auto;
      white-space: pre-wrap;
      background: #f4f4f4;
      padding: 1rem;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div id="log-container">
    <pre id="log-content">Connecting...</pre>
  </div>
  <script>
    const ws = new WebSocket('ws://localhost:8080');
    const logContent = document.getElementById('log-content');

    ws.onopen = () => {
      logContent.textContent = '';
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.lines) {
          data.lines.forEach(line => {
            if (line.trim()) {
              // Add a newline if there's already content
              logContent.textContent += (logContent.textContent ? '\n' : '') + line;
            }
          });
          // Auto-scroll to bottom
          logContent.scrollTop = logContent.scrollHeight;
        } else if (data.error) {
          logContent.textContent += (logContent.textContent ? '\n' : '') + `Error: ${data.error}`;
        }
      } catch (err) {
        console.error(err);
        logContent.textContent += (logContent.textContent ? '\n' : '') + 'Error processing data';
      }
    };

    ws.onerror = () => {
      logContent.textContent += (logContent.textContent ? '\n' : '') + 'WebSocket error occurred';
    };

    ws.onclose = () => {
      logContent.textContent += (logContent.textContent ? '\n' : '') + 'Connection closed';
    };
  </script>
</body>
</html>
```

---

## 🙌 Contributing
1. **Fork** this repository.
2. **Create** a new branch (`git checkout -b feature/myNewFeature`).
3. **Commit** your changes (`git commit -m "Add my new feature"`).
4. **Push** to the branch (`git push origin feature/myNewFeature`).
5. **Create** a new Pull Request on GitHub.

---

## 🔒 License
This project is licensed under the **MIT License**.  
See the [LICENSE](LICENSE) file for details.

---

## 🤝 Acknowledgments
- Inspired by Unix’s `tail -f`.
- Thanks to the [Node.js](https://nodejs.org/) community for their vibrant ecosystem.
- Shoutout to all open-source contributors making real-time applications accessible to everyone!

---

<p align="center">
  <b>Happy Monitoring! 🕶️</b>
</p>
