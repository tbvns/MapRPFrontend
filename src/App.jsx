// App.jsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MapContainer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';

import DrawControl from './DrawControl';
import WebSocketService from "./Messaging/WebSocketService.jsx";
import FoldSidebar from "./Sidebar/Actions.jsx";
import MarkerPopup from "./Sidebar/MarkerPopup.jsx";
import {loadInitialMapData, processBulkAddPacket} from "./Messaging/MapLoader.jsx";

const bounds = [[-10000000/2, -10000000/2], [10000000/2, 10000000/2]];

function getShapeStats(shape) {
    if (!shape) return null;
    const { geometry, properties } = shape;
    const stats = { type: properties.type, color: properties.color };

    // Conversion factors (assuming original units are meters)
    const METERS_TO_KM = 1000;
    const SQ_METERS_TO_SQ_KM = 1_000_000;

    switch (geometry.type) {
        case 'Polygon': {
            const coords = geometry.coordinates[0];
            const areaInSqMeters = coords.reduce((sum, [x1, y1], i) => {
                const [x2, y2] = coords[(i + 1) % coords.length];
                return sum + (x1 * y2 - x2 * y1);
            }, 0) / 2;
            stats.area = areaInSqMeters / SQ_METERS_TO_SQ_KM; // Convert to km²

            const perimeterInMeters = coords.reduce((sum, [x1, y1], i) => {
                const [x2, y2] = coords[(i + 1) % coords.length];
                return sum + Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
            }, 0);
            stats.perimeter = perimeterInMeters / METERS_TO_KM; // Convert to km
            break;
        }
        case 'LineString': {
            const lengthInMeters = geometry.coordinates.reduce((sum, [x1, y1], i, arr) =>
                    i > 0 ? sum + Math.sqrt((x1 - arr[i - 1][0]) ** 2 + (y1 - arr[i - 1][1]) ** 2) : 0
                , 0);
            stats.length = lengthInMeters / METERS_TO_KM; // Convert to km
            break;
        }
        case 'Point': {
            stats.position = geometry.coordinates;
            break;
        }
        case 'Circle': {
            if (properties.radius) {
                const radiusInMeters = properties.radius; // Assuming radius is in meters
                const areaInSqMeters = Math.PI * radiusInMeters * radiusInMeters;
                stats.area = areaInSqMeters / SQ_METERS_TO_SQ_KM; // Convert to km²

                const perimeterInMeters = 2 * Math.PI * radiusInMeters;
                stats.perimeter = perimeterInMeters / METERS_TO_KM; // Convert to km
            }
            stats.position = geometry.coordinates;
            break;
        }
        default:
            break;
    }
    return stats;
}

function CustomSVGOverlay({ url, bounds }) {
    const map = useMap();
    const overlayRef = useRef(null);

    useEffect(() => {
        let svgElement;

        fetch(url)
            .then(response => response.text())
            .then(svgContent => {
                svgElement = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svgElement.innerHTML = svgContent;

                svgElement.setAttribute('viewBox', '0 0 1000 1000');

                const svgOverlay = L.svgOverlay(svgElement, bounds);
                svgOverlay.addTo(map);
                overlayRef.current = svgOverlay;
            })
            .catch(error => console.error("Failed to load SVG for SVGOverlay:", error));

        return () => {
            if (overlayRef.current) {
                overlayRef.current.remove();
            }
        };
    }, [map, url, bounds]);

    return null;
}

function MapProvider({ children, setMapInstance, setIsMapFlying }) {
    const map = useMap();

    useEffect(() => {
        setMapInstance(map);

        const onMoveStart = () => setIsMapFlying(true);
        const onMoveEnd = () => setIsMapFlying(false);

        map.on('movestart', onMoveStart);
        map.on('moveend', onMoveEnd);

        return () => {
            map.off('movestart', onMoveStart);
            map.off('moveend', onMoveEnd);
        };
    }, [map, setMapInstance, setIsMapFlying]);

    return children;
}

export default function App() {
    const [shapes, setShapes] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [showSidebar, setshowSidebar] = useState(false);
    const [mapInstance, setMapInstance] = useState(null);
    const [isMapFlying, setIsMapFlying] = useState(false);

    const selectedShape = shapes.find(s => s.id === selectedId);
    const stats = getShapeStats(selectedShape);
    const markers = shapes.filter(s => s.properties.type === "marker");

    const handleIncomingMessage = useCallback((message) => {
        switch (message.type) {
            case 'add':
            case 'modify':
            {
                const geoJsonData = message.data || message.updates;
                if (geoJsonData && geoJsonData.geometry && typeof geoJsonData.geometry.type === 'string') {
                    // Validate coordinates for Polygon
                    if (geoJsonData.geometry.type === 'Polygon') {
                        const rings = geoJsonData.geometry.coordinates;
                        for (const ring of rings) {
                            for (const coordPair of ring) {
                                if (coordPair.length !== 2 || isNaN(coordPair[0]) || isNaN(coordPair[1]) || !Number.isFinite(coordPair[0]) || !Number.isFinite(coordPair[1])) {
                                    console.error("Invalid coordinate value (NaN/Infinity) in Polygon:", geoJsonData);
                                    return;
                                }
                            }
                        }
                    }

                    setShapes(prev => {
                        const existingIndex = prev.findIndex(s => s.id === (message.id || geoJsonData.id));
                        if (message.type === 'add') {
                            // If it's an 'add' and doesn't exist, add it
                            return existingIndex === -1 ? [...prev, geoJsonData] : prev;
                        } else { // modify
                            // If it's a 'modify' and exists, update it completely with the new geoJsonData
                            if (existingIndex !== -1) {
                                return prev.map((shape, index) =>
                                    index === existingIndex ? { ...geoJsonData, id: message.id || geoJsonData.id } : shape
                                );
                            } else {
                                // If modify for a non-existent shape, add it (edge case, but good for robustness)
                                console.warn("Received modify message for a non-existent shape, adding it:", geoJsonData);
                                return [...prev, geoJsonData];
                            }
                        }
                    });
                } else {
                    console.error("Received incomplete or invalid GeoJSON object:", message);
                }
                break;
            }

            case 'remove':
                setShapes(prev => prev.filter(shape => shape.id !== message.id));
                break;

            case 'bulkAdd':
                // No need to pass applyStylesCallback here, DrawControl will handle it
                processBulkAddPacket(message, setShapes);
                break;

            default:
                console.warn('Unknown message type:', message.type);
        }
    }, []);

    useEffect(() => {
        WebSocketService.connect();
        WebSocketService.registerMessageHandler(handleIncomingMessage);

        const loadMap = async () => {
            const initialData = await loadInitialMapData();
            if (initialData) {
                // Simply set the shapes. DrawControl's useEffect will handle rendering and styling.
                processBulkAddPacket(initialData, setShapes);
            }
        };
        loadMap();

        return () => WebSocketService.disconnect();
    }, [handleIncomingMessage]);

    const updateShapeProperty = (prop, value) => {
        setShapes(prev => {
            const updated = prev.map(shape => {
                if (shape.id === selectedId) {
                    const newProps = { ...shape.properties, [prop]: value };
                    const updatedShape = { ...shape, properties: newProps };
                    WebSocketService.sendMessage('modify', updatedShape, updatedShape.id);
                    return updatedShape;
                }
                return shape;
            });
            // The DrawControl's useEffect will re-render and re-style based on this update
            return updated;
        });
    };

    const handleMarkerButtonClick = useCallback((lat, lng, zoom = -2) => {
        if (mapInstance) {
            mapInstance.setView([lat, lng], zoom);
        }
    }, [mapInstance]);

    return (
        <div style={{ height: '100vh', width: '100vw', display: 'flex', fontFamily: 'Inter, sans-serif' }}>
            {showSidebar ? <MarkerPopup points={markers} onMarkerClick={handleMarkerButtonClick} onClose={() => setshowSidebar(false)} /> : <div/>}

            <MapContainer
                crs={L.CRS.Simple}
                center={[0, 0]}
                zoom={-14}
                minZoom={-15}
                maxZoom={4}
                style={{ flex: 1, height: '100%' }}
            >
                <MapProvider setMapInstance={setMapInstance} setIsMapFlying={setIsMapFlying}>
                    <CustomSVGOverlay url="/carte.svg" bounds={bounds} />

                    <DrawControl
                        onShapeUpdate={setShapes}
                        onShapeSelect={setSelectedId}
                        setIsEditing={setIsEditing}
                        isEditing={isEditing}
                        selectedId={selectedId}
                        shapes={shapes}
                        isMapFlying={isMapFlying}
                    />
                </MapProvider>
            </MapContainer>

            <FoldSidebar show={showSidebar} setShow={setshowSidebar}/>

            {isEditing && selectedShape ? (
                <div style={{
                    width: '150px',
                    padding: '24px',
                    background: '#ffffff',
                    overflowY: 'auto',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    borderLeft: '1px solid #e0e0e0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px', /* Reduced gap between main sections */
                    color: '#333',
                    fontSize: '14px',
                    lineHeight: '1.5'
                }}>
                    <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '4px', color: '#2c3e50' }}>Shape Properties</h2>

                    {selectedShape.properties.type === 'polyline' && (
                        <div style={{ marginBottom: '8px' }}> {/* Reduced margin-bottom */}
                            <label style={{ display: 'block', marginBottom: '4px', fontWeight: '500' }}>
                                Polyline Type:
                                <select
                                    value={selectedShape.properties.customType || 'default'}
                                    onChange={(e) => updateShapeProperty('customType', e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '8px',
                                        borderRadius: '4px',
                                        border: '1px solid #ccc',
                                        marginTop: '4px',
                                        boxSizing: 'border-box'
                                    }}
                                >
                                    <option value="default">Default Line (User Color)</option>
                                    <option value="motorway">Motorway</option>
                                    <option value="railway">Railway</option>
                                    <option value="path">Path</option>
                                    <option value="river">River</option>
                                </select>
                            </label>
                        </div>
                    )}

                    {(selectedShape.properties.type === 'polygon' || selectedShape.properties.type === 'circle') && (
                        <div style={{ marginBottom: '8px' }}> {/* Reduced margin-bottom */}
                            <label style={{ display: 'block', marginBottom: '4px', fontWeight: '500' }}>
                                Fill Type:
                                <select
                                    value={selectedShape.properties.customFillType || 'default'}
                                    onChange={(e) => updateShapeProperty('customFillType', e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '8px',
                                        borderRadius: '4px',
                                        border: '1px solid #ccc',
                                        marginTop: '4px',
                                        boxSizing: 'border-box'
                                    }}
                                >
                                    <option value="default">Solid Fill (User Color)</option>
                                    <option value="stripes">Stripes</option>
                                    <option value="dots">Dots</option>
                                    <option value="grid">Grid</option>
                                </select>
                            </label>
                        </div>
                    )}

                    {(selectedShape.properties.type === 'polygon' || selectedShape.properties.type === 'circle' ||
                        (selectedShape.properties.type === 'polyline' && selectedShape.properties.customType === 'default') ||
                        selectedShape.properties.type === 'marker') && (
                        <div style={{ marginBottom: '8px' }}> {/* Reduced margin-bottom */}
                            <label style={{ display: 'block', marginBottom: '4px', fontWeight: '500' }}>
                                {selectedShape.properties.type === 'polyline' ? 'Line Color' : (selectedShape.properties.type === 'marker' ? 'Marker Color' : 'Border/Fill Color')}:
                                <input
                                    type="color"
                                    value={selectedShape.properties.color}
                                    onChange={(e) => updateShapeProperty('color', e.target.value)}
                                    style={{
                                        width: '100%',
                                        padding: '4px',
                                        borderRadius: '4px',
                                        border: '1px solid #ccc',
                                        marginTop: '4px',
                                        boxSizing: 'border-box',
                                        height: '36px'
                                    }}
                                />
                            </label>
                        </div>
                    )}

                    <div style={{ marginBottom: '8px' }}> {/* Reduced margin-bottom */}
                        <label style={{ display: 'block', marginBottom: '4px', fontWeight: '500' }}>
                            Name:
                            <input
                                type="text"
                                value={selectedShape.properties.name}
                                onChange={(e) => updateShapeProperty('name', e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '8px',
                                    borderRadius: '4px',
                                    border: '1px solid #ccc',
                                    marginTop: '4px',
                                    boxSizing: 'border-box'
                                }}
                            />
                        </label>
                    </div>

                    <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '4px', color: '#2c3e50' }}>Statistics</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}> {/* New flex container for statistics */}
                        <p style={{ margin: 0 }}>Type: <span style={{ fontWeight: 'normal' }}>{stats.type}</span></p>
                        {stats.area && <p style={{ margin: 0 }}>Area: <span style={{ fontWeight: 'normal' }}>{Math.abs(stats.area).toFixed(2)} km²</span></p>}
                        {stats.perimeter && <p style={{ margin: 0 }}>Perimeter: <span style={{ fontWeight: 'normal' }}>{stats.perimeter.toFixed(2)} km</span></p>}
                        {stats.length && <p style={{ margin: 0 }}>Length: <span style={{ fontWeight: 'normal' }}>{stats.length.toFixed(2)} km</span></p>}
                        {stats.position && <p style={{ margin: 0 }}>Position: <span style={{ fontWeight: 'normal' }}>[{stats.position.map(n => n.toFixed(2)).join(', ')}]</span></p>}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
