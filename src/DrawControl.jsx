import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet.pattern/dist/leaflet.pattern-src.js';
import WebSocketService from "./Messaging/WebSocketService.jsx";

window.L = L;

const getPolylineStyle = (customType) => {
    switch (customType) {
        case 'motorway':
            return {
                color: '#800000',
                weight: 6,
                opacity: 0.9,
                dashArray: null
            };
        case 'railway':
            return {
                color: '#000000',
                weight: 4,
                opacity: 0.9,
                dashArray: '1, 10'
            };
        case 'path':
            return {
                color: '#8B4513',
                weight: 2,
                opacity: 0.7,
                dashArray: '5, 5'
            };
        case 'river':
            return {
                color: '#0000FF',
                weight: 5,
                opacity: 0.8,
                dashArray: null
            };
        case 'default':
        default:
            return {
                weight: 4,
                opacity: 0.8,
                dashArray: null
            };
    }
};


const getFillStyle = (customFillType, patternColor, map) => {
    let patternInstance;
    switch (customFillType) {
        case 'stripes':
            if (!map) return { fillOpacity: 0.7, fillPattern: null };
            patternInstance = new L.StripePattern({
                color: patternColor,
                weight: 3,
                spaceWeight: 6,
                angle: -45,
                spaceOpacity: 0,
                opacity: 1.0
            });
            patternInstance.addTo(map);
            return {
                fillOpacity: 0.7,
                fillPattern: patternInstance
            };
        case 'dots':
            if (!map) return { fillOpacity: 0.7, fillPattern: null };
            patternInstance = new L.Pattern({
                width: 15,
                height: 15,
            });
            patternInstance.addShape(new L.PatternCircle({
                x: 7.5,
                y: 7.5,
                radius: 3,
                fill: true,
                fillColor: patternColor,
                fillOpacity: 1.0,
                stroke: false
            }));
            patternInstance.addTo(map);
            return {
                fillOpacity: 0.7,
                fillPattern: patternInstance
            };
        case 'grid':
            if (!map) return { fillOpacity: 0.7, fillPattern: null };
            patternInstance = new L.Pattern({
                width: 10,
                height: 10,
            });
            patternInstance.addShape(new L.PatternPath({
                d: 'M0,5 H10',
                stroke: true,
                color: patternColor,
                weight: 1,
                opacity: 1.0
            }));
            patternInstance.addShape(new L.PatternPath({
                d: 'M5,0 V10',
                stroke: true,
                color: patternColor,
                weight: 1,
                opacity: 1.0
            }));
            patternInstance.addTo(map);
            return {
                fillOpacity: 0.7,
                fillPattern: patternInstance
            };
        case 'default':
        default:
            return {
                fillOpacity: 0.5,
                fillPattern: null
            };
    }
};

const cleanCoordinatePair = (coordPair) => {
    if (!Array.isArray(coordPair) || coordPair.length !== 2) {
        console.warn("Expected [lon, lat] pair, got non-array or wrong length:", coordPair);
        return [0, 0];
    }
    const lon = parseFloat(coordPair[0]);
    const lat = parseFloat(coordPair[1]);

    if (isNaN(lon) || isNaN(lat) || !Number.isFinite(lon) || !Number.isFinite(lat)) {
        console.warn("Invalid coordinate value (NaN/Infinity) detected, defaulting to 0:", coordPair);
        return [0, 0];
    }
    return [lon, lat];
};

const cleanCoordinatesRecursive = (coordinates) => {
    if (!Array.isArray(coordinates)) {
        return coordinates;
    }

    if (coordinates.length === 2 && (typeof coordinates[0] === 'number' || typeof coordinates[0] === 'string') && (typeof coordinates[1] === 'number' || typeof coordinates[1] === 'string')) {
        return cleanCoordinatePair(coordinates);
    }

    return coordinates.map(subCoord => cleanCoordinatesRecursive(subCoord));
};

const ensurePolygonClosedAndClean = (geoJsonFeature) => {
    const newFeature = JSON.parse(JSON.stringify(geoJsonFeature));

    if (!newFeature.properties) {
        newFeature.properties = {};
    }
    if (!newFeature.geometry) {
        newFeature.geometry = { type: null, coordinates: [] };
    }

    if (Array.isArray(newFeature.geometry.coordinates)) {
        newFeature.geometry.coordinates = cleanCoordinatesRecursive(newFeature.geometry.coordinates);

        if (newFeature.geometry.type === 'Polygon') {
            const rings = newFeature.geometry.coordinates;
            for (let i = 0; i < rings.length; i++) {
                const ring = rings[i];
                if (Array.isArray(ring) && ring.length > 0) {
                    const firstPoint = ring[0];
                    const lastPoint = ring[ring.length - 1];

                    if (firstPoint[0] !== lastPoint[0] || firstPoint[1] !== lastPoint[1]) {
                        console.warn("Polygon ring not closed, closing it for feature ID:", newFeature.id || 'unknown', ring);
                        ring.push([...firstPoint]);
                    }
                } else {
                    console.warn("Invalid polygon ring structure detected, replacing with empty array for feature ID:", newFeature.id || 'unknown', ring);
                    rings[i] = [];
                }
            }
        }
    }
    return newFeature;
};


function DrawControl({ onShapeUpdate, onShapeSelect, setIsEditing, isEditing, selectedId, shapes, isMapFlying }) {
    const map = useMap();
    const [drawnItems] = useState(() => new L.FeatureGroup());
    const drawControlRef = useRef(null);
    const layerMapRef = useRef({}); // Stores Leaflet layers keyed by shape.id

    // Storing refs to handlers to ensure stability for Leaflet event listeners
    const handleCreateRef = useRef(null);
    const handleEditRef = useRef(null);
    const handleDeleteRef = useRef(null);
    const shapesRef = useRef(shapes); // Ref to latest shapes state for handlers

    useEffect(() => {
        shapesRef.current = shapes;
    }, [shapes]);

    const applyCurrentStyles = useCallback((currentShapes) => {
        if (!map) return;
        currentShapes.forEach(shape => {
            const layer = layerMapRef.current[shape.id];
            if (layer) {
                // Ensure layer.feature.properties is up-to-date for styling logic
                if (!layer.feature) layer.feature = { properties: {} };
                if (!layer.feature.properties) layer.feature.properties = {};
                layer.feature.properties = { ...layer.feature.properties, ...shape.properties };

                if (shape.properties.type === 'polyline') {
                    const style = getPolylineStyle(shape.properties.customType);
                    layer.setStyle({
                        ...style,
                        color: shape.properties.customType === 'default' ? shape.properties.color : style.color
                    });
                } else if (shape.properties.type === 'polygon' || shape.properties.type === 'rectangle' || shape.properties.type === 'circle') {
                    const fillStyle = getFillStyle(shape.properties.customFillType, shape.properties.color, map);
                    layer.setStyle({
                        color: shape.properties.color,
                        weight: layer.options.weight || 3,
                        fillPattern: fillStyle.fillPattern,
                        fillColor: shape.properties.color,
                        fillOpacity: fillStyle.fillOpacity
                    });
                } else if (shape.properties.type === 'marker') {
                    if (layer.setIcon) {
                        layer.setIcon(L.divIcon({
                            className: 'custom-marker-icon',
                            html: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                     <path d="M12 0C7.31 0 3.5 3.81 3.5 8.5C3.5 15.31 12 24 12 24C12 24 20.5 15.31 20.5 8.5C20.5 3.81 16.69 0 12 0ZM12 13C9.24 13 7 10.76 7 8C7 5.24 9.24 3 12 3C14.76 3 17 5.24 17 8C17 10.76 14.76 13 12 13Z" fill="${shape.properties.color}"/>
                                   </svg>`,
                            iconSize: [24, 24],
                            iconAnchor: [12, 24],
                            popupAnchor: [0, -20]
                        }));
                    }
                } else {
                    if (layer.setStyle) {
                        layer.setStyle({ color: shape.properties.color, fillColor: shape.properties.color });
                    }
                }
                if (layer.bindPopup && shape.properties.name) {
                    layer.bindPopup(`<b>${layer.feature.properties.name}</b>`);
                } else if (layer.bindPopup) {
                    layer.bindPopup(`Shape ID: ${shape.id}`);
                }
            }
        });
    }, [map]);


    const handleCreate = useCallback((e) => {
        const layer = e.layer;
        const shapeType = e.layerType;
        const defaultColor = '#3388ff';

        let initialProperties = {
            name: `Unnamed ${shapeType}`,
            color: defaultColor,
            type: shapeType,
            id: L.Util.stamp(layer)
        };

        // Apply initial styles based on type
        if (shapeType === 'polyline') {
            initialProperties.customType = 'default';
            const defaultPolylineStyle = getPolylineStyle('default');
            layer.setStyle({ ...defaultPolylineStyle, color: initialProperties.color });
        } else if (shapeType === 'polygon' || shapeType === 'circle' || shapeType === 'rectangle') {
            initialProperties.customFillType = 'default';
            const defaultFillStyle = getFillStyle('default', initialProperties.color, map);
            layer.setStyle({
                color: initialProperties.color,
                fillColor: initialProperties.color,
                fillOpacity: defaultFillStyle.fillOpacity,
                fillPattern: defaultFillStyle.fillPattern
            });
        } else if (shapeType === 'marker') {
            layer.setIcon(L.divIcon({
                className: 'custom-marker-icon',
                html: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                         <path d="M12 0C7.31 0 3.5 3.81 3.5 8.5C3.5 15.31 12 24 12 24C12 24 20.5 15.31 20.5 8.5C20.5 3.81 16.69 0 12 0ZM12 13C9.24 13 7 10.76 7 8C7 5.24 9.24 3 12 3C14.76 3 17 5.24 17 8C17 10.76 14.76 13 12 13Z" fill="${initialProperties.color}"/>
                       </svg>`,
                iconSize: [24, 24],
                iconAnchor: [12, 24],
                popupAnchor: [0, -20]
            }));
        } else {
            layer.setStyle?.({ color: initialProperties.color, fillColor: initialProperties.color });
        }

        // Get the full GeoJSON from the newly created layer
        const geoJson = layer.toGeoJSON();
        geoJson.id = initialProperties.id; // Assign the generated ID
        geoJson.properties = initialProperties; // Assign initial properties

        // Set layer.feature to the complete GeoJSON object immediately
        layer.feature = geoJson;

        layer.bindPopup(`<b>${layer.feature.properties.name}</b>`);
        layer.on('click', () => onShapeSelect(layer.feature.properties.id));

        drawnItems.addLayer(layer);
        layerMapRef.current[layer.feature.properties.id] = layer;

        onShapeUpdate(prev => [...prev, geoJson]);
        WebSocketService.sendMessage('add', geoJson);
    }, [drawnItems, onShapeUpdate, onShapeSelect, map]);

    const handleEdit = useCallback((e) => {
        const layers = e.layers;
        layers.eachLayer(layer => {
            // Get the current properties from the existing shape in state
            const existingShape = shapesRef.current.find(s => s.id === layer.feature.id);
            if (!existingShape) {
                console.warn("Edited layer not found in current shapes state:", layer.feature.id);
                return;
            }

            const editedGeoJson = layer.toGeoJSON();
            // Preserve existing properties unless explicitly changed by editing
            const updatedFeature = {
                ...existingShape, // Start with existing shape to keep all properties
                geometry: editedGeoJson.geometry, // Update only geometry from edited GeoJSON
            };

            // Update layer.feature to reflect the new state for styling and future use
            layer.feature = updatedFeature;

            WebSocketService.sendMessage('modify', updatedFeature, updatedFeature.id);
            onShapeUpdate(prev => prev.map(f =>
                f.id === existingShape.id ? updatedFeature : f
            ));
        });
    }, [onShapeUpdate]);

    const handleDelete = useCallback((e) => {
        const layers = e.layers;
        layers.eachLayer(layer => {
            if (layer.feature && layer.feature.properties) {
                delete layerMapRef.current[layer.feature.properties.id];
                WebSocketService.sendMessage('remove', null, layer.feature.properties.id);
                onShapeUpdate(prev => prev.filter(f => f.id !== layer.feature.properties.id));
            }
        });
    }, [onShapeUpdate]);

    useEffect(() => { handleCreateRef.current = handleCreate; }, [handleCreate]);
    useEffect(() => { handleEditRef.current = handleEdit; }, [handleEdit]);
    useEffect(() => { handleDeleteRef.current = handleDelete; }, [handleDelete]);

    useEffect(() => {
        if (!map) return;

        if (L.EditToolbar && L.EditToolbar.Delete) {
            L.EditToolbar.Delete.include({ removeAllLayers: false });
        }

        map.addLayer(drawnItems);

        drawControlRef.current = new L.Control.Draw({
            edit: { featureGroup: drawnItems, edit: {}, remove: {} },
            draw: {
                polyline: {}, polygon: { showArea: true }, rectangle: false,
                marker: {}, circle: false, circlemarker: false
            }
        });
        map.addControl(drawControlRef.current);

        const createdHandler = (e) => handleCreateRef.current && handleCreateRef.current(e);
        const editedHandler = (e) => handleEditRef.current && handleEditRef.current(e);
        const deletedHandler = (e) => handleDeleteRef.current && handleDeleteRef.current(e);

        map.on(L.Draw.Event.CREATED, createdHandler);
        map.on(L.Draw.Event.EDITED, editedHandler);
        map.on(L.Draw.Event.DELETED, deletedHandler);

        const editStartHandler = () => {
            setIsEditing(true);
            applyCurrentStyles(shapesRef.current); // Ensure styles are correct when editing starts
        };
        const editStopHandler = () => {
            setIsEditing(false);
            applyCurrentStyles(shapesRef.current); // Ensure styles are correct when editing stops
        };

        map.on(L.Draw.Event.EDITSTART, editStartHandler);
        map.on(L.Draw.Event.EDITSTOP, editStopHandler);

        return () => {
            map.off(L.Draw.Event.CREATED, createdHandler);
            map.off(L.Draw.Event.EDITED, editedHandler);
            map.off(L.Draw.Event.DELETED, deletedHandler);
            map.off(L.Draw.Event.EDITSTART, editStartHandler);
            map.off(L.Draw.Event.EDITSTOP, editStopHandler);

            if (drawControlRef.current) {
                map.removeControl(drawControlRef.current);
                drawControlRef.current = null;
            }
            drawnItems.clearLayers();
            layerMapRef.current = {};
        };
    }, [map, drawnItems, setIsEditing, applyCurrentStyles]);


    // This useEffect is critical for synchronizing Leaflet layers with the 'shapes' state.
    // It should handle:
    // 1. Removing layers that are no longer in 'shapes'.
    // 2. Creating new layers for shapes added to 'shapes'.
    // 3. Updating existing layers if their *geometry* has changed.
    // 4. Applying styles to all layers based on their properties.
    useEffect(() => {
        if (!map) return;

        const currentShapeIds = new Set(shapes.map(s => s.id.toString()));

        // Remove layers that are no longer in the 'shapes' state
        Object.keys(layerMapRef.current).forEach(id => {
            if (!currentShapeIds.has(id)) {
                const layerToRemove = layerMapRef.current[id];
                if (layerToRemove) {
                    if (layerToRemove.editing && layerToRemove.editing.enabled()) {
                        try {
                            layerToRemove.editing.disable();
                        } catch (e) {
                            console.warn(`Error disabling editing for layer ${id} before removal:`, e);
                        }
                    }
                    drawnItems.removeLayer(layerToRemove);
                    map.removeLayer(layerToRemove); // Ensure it's removed from the map
                }
                delete layerMapRef.current[id];
            }
        });

        shapes.forEach(feature => {
            let layer = layerMapRef.current[feature.id];
            const cleanedFeature = ensurePolygonClosedAndClean(feature); // Always clean feature before use

            let shouldRecreateLayer = false;

            if (layer) {
                // If layer exists, check if its geometry has changed.
                // Safely check for geometry existence before accessing its properties.
                if (layer.feature && layer.feature.geometry) {
                    if (layer.feature.geometry.type !== cleanedFeature.geometry.type ||
                        JSON.stringify(layer.feature.geometry.coordinates) !== JSON.stringify(cleanedFeature.geometry.coordinates)) {
                        shouldRecreateLayer = true;
                    }
                } else {
                    // If layer exists but its feature or feature.geometry is missing, it's in a bad state, recreate.
                    shouldRecreateLayer = true;
                    console.warn(`Layer ${feature.id} found in map but layer.feature or layer.feature.geometry is missing. Recreating.`);
                }
            } else {
                // Layer does not exist, so it's a new layer, always recreate.
                shouldRecreateLayer = true;
            }


            if (shouldRecreateLayer) {
                // Remove old layer if it existed
                if (layer) {
                    if (layer.editing && layer.editing.enabled()) {
                        try {
                            layer.editing.disable();
                        } catch (e) {
                            console.warn(`Error disabling editing for old layer ${feature.id} before recreation:`, e);
                        }
                    }
                    drawnItems.removeLayer(layer);
                    map.removeLayer(layer);
                    delete layerMapRef.current[feature.id];
                }

                // Create a new layer based on the updated/new feature
                if (cleanedFeature.geometry.type === 'Circle') {
                    const center = L.latLng(cleanedFeature.geometry.coordinates);
                    const fillStyle = getFillStyle(cleanedFeature.properties.customFillType, cleanedFeature.properties.color, map);
                    layer = L.circle(center, {
                        radius: cleanedFeature.properties.radius,
                        color: cleanedFeature.properties.color,
                        weight: 3,
                        fillColor: cleanedFeature.properties.color,
                        fillOpacity: fillStyle.fillOpacity,
                        fillPattern: fillStyle.fillPattern
                    });
                } else if (cleanedFeature.geometry.type === 'Point' && cleanedFeature.properties.type === 'marker') {
                    const latlng = L.latLng(cleanedFeature.geometry.coordinates[1], cleanedFeature.geometry.coordinates[0]);
                    layer = L.marker(latlng, {
                        icon: L.divIcon({
                            className: 'custom-marker-icon',
                            html: `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                      <path d="M12 0C7.31 0 3.5 3.81 3.5 8.5C3.5 15.31 12 24 12 24C12 24 20.5 15.31 20.5 8.5C20.5 3.81 16.69 0 12 0ZM12 13C9.24 13 7 10.76 7 8C7 5.24 9.24 3 12 3C14.76 3 17 5.24 17 8C17 10.76 14.76 13 12 13Z" fill="${cleanedFeature.properties.color}"/>
                                    </svg>`,
                            iconSize: [24, 24],
                            iconAnchor: [12, 24],
                            popupAnchor: [0, -20]
                        })
                    });
                } else {
                    const geoJsonToProcess = {
                        type: 'Feature',
                        geometry: cleanedFeature.geometry,
                        properties: cleanedFeature.properties
                    };
                    layer = L.geoJSON(geoJsonToProcess).getLayers()[0];
                }

                if (layer) {
                    layer.feature = cleanedFeature; // Store the full feature on the Leaflet layer
                    layerMapRef.current[cleanedFeature.id] = layer;
                    drawnItems.addLayer(layer);
                    layer.on('click', () => onShapeSelect(cleanedFeature.id));

                    if (layer.editing) {
                        try {
                            if (!layer.editing.enabled()) {
                                layer.editing.enable();
                                layer.editing.disable();
                            }
                        } catch (e) {
                            console.warn(`Could not properly initialize editing for layer ${cleanedFeature.id}:`, e);
                        }
                    }
                } else {
                    console.error("Could not create layer from GeoJSON:", cleanedFeature);
                    return;
                }
            }
            // Always apply styles to ensure property changes (like color, fill type) are reflected
            // This is done for both newly created and existing layers (if geometry didn't change)
            applyCurrentStyles([cleanedFeature]);
        });
    }, [shapes, map, onShapeSelect, drawnItems, applyCurrentStyles]);

    useEffect(() => {
        // Only enable editing for the selected shape if the global edit mode is active.
        Object.values(layerMapRef.current).forEach(layer => {
            if (layer.feature && layer.editing) {
                if (layer.feature.id === selectedId && isEditing) { // Only enable if selected AND global edit mode is on
                    if (!layer.editing.enabled()) {
                        layer.editing.enable();
                    }
                } else {
                    if (layer.editing.enabled()) {
                        layer.editing.disable();
                    }
                }
            }
        });
        // The setIsEditing state is now solely managed by the L.Draw.Event.EDITSTART/EDITSTOP handlers.
    }, [selectedId, isEditing]); // Depend on isEditing as well

    return null;
}

export default DrawControl;
