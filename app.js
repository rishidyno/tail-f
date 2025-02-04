// Import required modules
const fs = require('fs');  // File system module to interact with files
const WebSocket = require('ws');  // WebSocket module to create WebSocket server
const path = require('path');  // Path module to handle and transform file paths

// Set the path of the log file to monitor and the WebSocket server's port number
const LOG_FILE_PATH = path.join(__dirname, 'logs.txt');  // Log file path relative to the current directory
const PORT = 8080;  // Port on which WebSocket server will listen for incoming connections

// Variable to store the last read position in the file (for tracking new lines)
let lastFileSize = 0;

// Variable to hold debounce timeout to prevent multiple file checks in a short time
let debounceTimeout;

// function getLastNLines(filePath, n) {
//     return new Promise((resolve, reject) => {
//         fs.readFile(filePath, 'utf-8', (err, data) => {
//             if (err) return reject(err);
//             const lines = data.split('\n');
//             resolve(lines.slice(-n).filter(line => line.trim()));
//         })
//     })
// }

// Function to get the last N lines of a file by reading it in reverse
function getLastNLines(filePath, n) {
    return new Promise((resolve, reject) => {
        // Open the log file for reading
        fs.open(filePath, 'r', (err, fd) => {
            if (err) return reject(err);  // If there's an error opening the file, reject the promise

            const bufferSize = 1024;  // Size of each chunk we read from the file (in bytes)
            const buffer = Buffer.alloc(bufferSize);  // Allocate buffer to store file chunks
            let lines = [];  // Array to store lines read from the file
            let leftover = '';  // Variable to hold leftover data that doesn't form a full line
            let fileSize;  // Variable to store the size of the file

            // Get file stats to determine the size of the file
            fs.fstat(fd, (err, stats) => {
                if (err) {
                    fs.close(fd, () => {});  // Close file if error occurs
                    return reject(err);  // Reject the promise on error
                }

                fileSize = stats.size;  // Store the file size

                let position = fileSize;  // Start reading from the end of the file

                // Helper function to read file chunks in reverse
                function readChunk() {
                    const bytesToRead = Math.min(position, bufferSize);  // Determine how many bytes to read
                    const start = position - bytesToRead;  // Calculate start position for the read

                    if (bytesToRead <= 0) {
                        // If no bytes left to read, process the leftover part (incomplete line)
                        if (leftover) {
                            lines.unshift(leftover);  // Add leftover to the beginning of the lines array
                        }
                        fs.close(fd, () => {});  // Close the file
                        resolve(lines.slice(-n));  // Return the last N lines (as requested)
                        return;
                    }

                    // Read the chunk from the file
                    fs.read(fd, buffer, 0, bytesToRead, start, (err, bytesRead) => {
                        if (err) {
                            fs.close(fd, () => {});  // Close file on error
                            return reject(err);  // Reject the promise on error
                        }

                        position -= bytesRead;  // Update position to reflect the number of bytes read
                        const chunk = buffer.toString('utf-8', 0, bytesRead);  // Convert the buffer chunk to a string
                        const chunkLines = (chunk + leftover).split('\n');  // Split chunk into lines

                        leftover = chunkLines.shift();  // Store leftover (if any) for the next chunk

                        lines = chunkLines.concat(lines);  // Prepend the chunk lines to the existing lines

                        if (lines.length >= n) {
                            // If we've gathered enough lines, stop reading and return the result
                            fs.close(fd, () => {});
                            resolve(lines.slice(-n));  // Return the last N lines
                            return;
                        }

                        readChunk();  // Continue reading the next chunk if needed
                    });
                }
                readChunk();  // Start the process of reading chunks from the end of the file
            });
        });
    });
}

// Function to read new lines added to the file after the last known position
function getNewLines(filePath, fromPosition) {
    return new Promise((resolve, reject) => {
        // Create a read stream starting from the last known position in the file
        const stream = fs.createReadStream(filePath, {
            encoding: 'utf-8',
            start: fromPosition,  // Start reading from the last known position
        });

        let data = '';  // Variable to accumulate the data read from the stream

        // Handle data event to accumulate chunks of data
        stream.on('data', chunk => (data += chunk));

        // Handle end of stream, process the accumulated data
        stream.on('end', () => {
            const lines = data.split('\n').filter(line => line.trim());  // Split data into non-empty lines
            resolve(lines);  // Return the new lines
        });

        // Handle error event and reject the promise if an error occurs
        stream.on('error', reject);
    });
}

// Create WebSocket server to allow real-time log monitoring
const wss = new WebSocket.Server({ port: PORT }, () => {
    console.log(`Websocket server started at ws://localhost:${PORT}`);
});

// When a new client connects to the WebSocket server
wss.on('connection', (ws) => {
    console.log('Client connected');

    // Send the last 10 lines of the log file to the client upon connection
    getLastNLines(LOG_FILE_PATH, 10)
        .then((lines) => {
            ws.send(JSON.stringify({ lines }));  // Send the lines as a JSON message
        })
        .catch((error) => {
            console.error('Error reading log files:', error);
            ws.send(JSON.stringify({ error: 'Unable to read file' }));  // Send error message if reading fails
        });

    // When the client disconnects, log the event
    ws.on('close', () => {
        console.log('Client disconnected');
    });
});

// Watch for changes in the log file
fs.watch(LOG_FILE_PATH, async (eventType) => {
    if (eventType === 'change') { // WatchEventType = "rename" | "change";
        // If the file has changed, debounce the check to avoid excessive checks
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(async () => {
            try {
                const stats = await fs.promises.stat(LOG_FILE_PATH);  // Get the current file stats (size)
                if (stats.size > lastFileSize) {  // If the file size has increased, new lines have been added
                    const newLines = await getNewLines(LOG_FILE_PATH, lastFileSize);  // Get the new lines added
                    lastFileSize = stats.size;  // Update the last known file size

                    // Broadcast the new lines to all connected WebSocket clients
                    wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({ lines: newLines }));
                        }
                    });
                }
            } catch (error) {
                // Handle error if file stats retrieval fails (e.g., file does not exist)
            }
        }, 100);  // Delay subsequent checks by 100ms to debounce
    }
});

// Initialize the last file size when the server starts, so we can track new lines
fs.promises.stat(LOG_FILE_PATH)
    .then(stats => {
        lastFileSize = stats.size;  // Set the initial last file size
    })
    .catch(() => {
        console.log('Error: Could not read the log file');
        lastFileSize = 0;  // Initialize file size to 0 if the file doesn't exist or cannot be accessed
    });



// const fs = require('fs');
// const WebSocket = require('ws');
// const path = require('path');

// const LOG_FILE_PATH = path.join(__dirname, 'logs.txt');
// const PORT = 8080;

// let lastFileSize = 0;
// let debounceTimeout;

// // function getLastNLines(filePath, n) {
// //     return new Promise((resolve, reject) => {
// //         fs.readFile(filePath, 'utf-8', (err, data) => {
// //             if (err) return reject(err);
// //             const lines = data.split('\n');
// //             resolve(lines.slice(-n).filter(line => line.trim()));
// //         })
// //     })
// // }
// function getLastNLines(filePath, n) {
//     return new Promise((resolve, reject) => {
//         fs.open(filePath, 'r', (err, fd) => {
//             if (err) return reject(err);
            
//             const bufferSize = 1024;
//             const buffer = Buffer.alloc(bufferSize);
//             let lines = [];
//             let leftover = '';
//             let fileSize;

//             fs.fstat(fd, (err, stats) => {
//                 if (err) {
//                     fs.close(fd, () => {});
//                     return reject(err);
//                 }

//                 fileSize = stats.size;

//                 let position = fileSize;

//                 function readChunk() {
//                     const bytesToRead = Math.min(position, bufferSize);
//                     const start = position - bytesToRead;

//                     if (bytesToRead <= 0) {
//                         if (leftover) {
//                             lines.unshift(leftover);
//                         }
//                         fs.close(fd, () => {});
//                         resolve(lines.slice(-n));
//                         return;
//                     }

//                     fs.read(fd, buffer, 0, bytesToRead, start, (err, bytesToRead) => {
//                         if (err) {
//                             fs.close(fd, () => {});
//                             return reject(err);
//                         }

//                         position -= bytesToRead;
//                         const chunk = buffer.toString('utf-8', 0, bytesToRead);
//                         const chunkLines = (chunk + leftover).split('\n');

//                         leftover = chunkLines.shift();

//                         lines = chunkLines.concat(lines);

//                         if (lines.length >= n) {
//                             fs.close(fd, () => {});
//                             resolve(lines.slice(-n));
//                             return;
//                         }

//                         readChunk();
//                     })
//                 }
//                 readChunk();
//             })
//         })
//     })
// }

// function getNewLines(filePath, fromPosition) {
//     return new Promise((resolve, reject) => {
//         const stream = fs.createReadStream(filePath, {
//             encoding: 'utf-8',
//             start: fromPosition,
//         })

//         let data = '';
//         stream.on('data', chunk => (data += chunk));
//         stream.on('end', () => {
//             const lines = data.split('\n').filter(line => line.trim());
//             resolve(lines);
//         });
//         stream.on('error', reject);
//     })
// }
// const wss = new WebSocket.Server({ port: PORT }, () => {
//     console.log(`Websocket server started at ws://localhost:${PORT}`);
// });

// wss.on('connection', (ws) => {
//     console.log('Client connected');

//     getLastNLines(LOG_FILE_PATH, 10)
//         .then((lines) => {
//             ws.send(JSON.stringify({ lines }));
//         })
//         .catch((error) => {
//             console.error('Error reading log files:', error);
//             ws.send(JSON.stringify({ error: 'Unable to read file' }));
//         });

//     ws.on('close', () => {
//         console.log('Client disconnected');
//     })
// })

// fs.watch(LOG_FILE_PATH, async (eventType) => {
//     if (eventType === 'change') {
//         clearTimeout(debounceTimeout);
//         debounceTimeout = setTimeout(async () => {
//             try {
//                 const stats = await fs.promises.stat(LOG_FILE_PATH);
//                 if (stats.size > lastFileSize) {
//                     const newLines = await getNewLines(LOG_FILE_PATH, lastFileSize);
//                     lastFileSize = stats.size;

//                     wss.clients.forEach((client) => {
//                         if (client.readyState === WebSocket.OPEN) {
//                             client.send(JSON.stringify({ lines: newLines}));
//                         };
//                     })
//                 }
//             } catch (error) {
//             }
//         }, 100)
//     }
// });

// fs.promises.stat(LOG_FILE_PATH)
//     .then(stats => {
//         lastFileSize = stats.size;
//     })
//     .catch(() => {
//         console.log('err');
//         lastFileSize = 0;
//     })
