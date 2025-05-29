import SockJS from 'sockjs-client';
import { Client } from '@stomp/stompjs';

class WebSocketService {
    constructor() {
        this.client = null;
        this.subscription = null;
        this.messageCallback = null;
    }

    connect(callback) {
        if (this.client) return;

        // Ensure the WebSocket URL is correct for your environment
        const socket = new SockJS('http://localhost:8080/ws');
        this.client = new Client({
            webSocketFactory: () => socket,
            reconnectDelay: 5000, // Time in milliseconds to wait before attempting to reconnect
            debug: (str) => console.debug(str), // For debugging STOMP communication
            onConnect: () => {
                console.log('WebSocket connected');
                // Subscribe to the topic where map updates are published
                this.subscription = this.client.subscribe('/topic/mapUpdate', (message) => {
                    if (this.messageCallback) {
                        try {
                            const parsedMessage = JSON.parse(message.body);
                            this.messageCallback(parsedMessage);
                        } catch (error) {
                            console.error("Failed to parse incoming message:", message.body, error);
                        }
                    }
                });
                if (callback) callback(); // Optional callback after connection
            },
            onStompError: (frame) => {
                // Will be invoked in case of error encountered at Broker
                // Bad login/passcode typically will cause an ERROR frame
                console.error('Broker reported error: ' + frame.headers['message']);
                console.error('Additional details: ' + frame.body);
            },
            onWebSocketError: (event) => {
                // Will be invoked if the WebSocket connection itself encounters an error
                console.error('WebSocket error:', event);
            },
            onDisconnect: () => {
                console.log('WebSocket disconnected');
            }
        });

        this.client.activate(); // Initiate the connection
    }

    registerMessageHandler(callback) {
        // Registers a callback function to handle incoming messages
        this.messageCallback = callback;
    }

    sendMessage(type, data, id) {
        // Check if the Stomp client is initialized and connected
        if (!this.client || !this.client.connected) {
            console.warn('WebSocket not connected. Message not sent:', { type, data, id });
            return;
        }

        console.log("Sending message:", { type, data, id });

        let messagePayload;
        switch (type) {
            case 'add':
                // For adding a single shape
                messagePayload = { type: 'add', data };
                break;
            case 'modify':
                // For modifying an existing shape
                // 'id' is crucial here to identify which shape to modify
                messagePayload = { type: 'modify', id, data };
                break;
            case 'remove':
                // For removing a shape
                // 'id' identifies the shape to be removed
                messagePayload = { type: 'remove', id };
                break;
            case 'bulkAdd':
                // For adding multiple shapes at once
                // 'data' is expected to be an array of shape objects
                if (!Array.isArray(data)) {
                    console.error('Invalid data for bulkAdd: Expected an array.', data);
                    return;
                }
                messagePayload = { type: 'bulkAdd', data };
                break;
            default:
                console.error('Invalid message type:', type);
                return;
        }

        // Publish the message to the destination '/app/mapUpdate'
        // The server-side STOMP endpoint should be configured to handle this destination
        this.client.publish({
            destination: '/app/mapUpdate',
            body: JSON.stringify(messagePayload)
        });
    }

    disconnect() {
        // Deactivates the client, cleaning up the connection
        if (this.client) {
            this.client.deactivate();
            this.client = null;
            console.log('WebSocket service deactivated.');
        }
    }
}

// Export a singleton instance of the service
export default new WebSocketService();
