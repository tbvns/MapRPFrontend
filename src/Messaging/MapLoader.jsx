// MapLoader.jsx
import WebSocketService from "./WebSocketService.jsx";

export async function loadInitialMapData() {
    try {
        const response = await fetch('/api/getMaps');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const packet = await response.json();
        return packet;
    } catch (error) {
        console.error('Failed to load initial map data:', error);
        return null;
    }
}

export function processBulkAddPacket(packet, setShapes) { // Removed applyStylesCallback
    if (packet && packet.type === 'bulkAdd' && Array.isArray(packet.data)) {
        setShapes(packet.data);
    }
}
