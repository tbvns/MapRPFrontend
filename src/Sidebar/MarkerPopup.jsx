import React, { useState } from 'react';

function MarkerPopup({ points, onMarkerClick, onClose }) {
    const [searchTerm, setSearchTerm] = useState('');

    const searchedPoints = points.filter(point =>
        point.properties.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const seenIds = new Set();
    const uniqueFilteredPoints = searchedPoints.filter(point => {
        if (seenIds.has(point.properties.id)) {
            return false;
        } else {
            seenIds.add(point.properties.id);
            return true;
        }
    });

    const handleButtonClick = (point) => {
        if (point.geometry && point.geometry.coordinates) {
            onMarkerClick(point.geometry.coordinates[1], point.geometry.coordinates[0], 1);
            onClose();
        }
    };

    return (
        <div style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '350px',
            maxHeight: '80vh',
            background: '#ffffff',
            borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 1000,
            overflow: 'hidden'
        }}>
            <div style={{
                padding: '16px 24px',
                borderBottom: '1px solid #e0e0e0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: '#f8f8f8',
                borderTopLeftRadius: '12px',
                borderTopRightRadius: '12px'
            }}>
                <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#2c3e50', margin: 0 }}>Markers</h2>
                <button
                    onClick={onClose}
                    style={{
                        background: 'none',
                        border: 'none',
                        fontSize: '24px',
                        cursor: 'pointer',
                        color: '#666',
                        padding: '4px',
                        borderRadius: '50%',
                        transition: 'background-color 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}
                >
                    &times;
                </button>
            </div>

            <div style={{ padding: '16px 24px', borderBottom: '1px solid #e0e0e0' }}>
                <input
                    type="text"
                    placeholder="Search markers..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: '8px',
                        border: '1px solid #ccc',
                        fontSize: '16px',
                        boxSizing: 'border-box'
                    }}
                />
            </div>

            <div style={{ flexGrow: 1, overflowY: 'auto', padding: '16px 24px' }}>
                {uniqueFilteredPoints.length !== 0 ? (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                    }}>
                        {uniqueFilteredPoints.map((point) => (
                            <button
                                key={point.properties.id}
                                onClick={() => handleButtonClick(point)}
                                style={{
                                    width: '100%',
                                    padding: '10px 16px',
                                    borderRadius: '8px',
                                    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
                                    fontWeight: '600',
                                    color: '#ffffff',
                                    backgroundColor: point.properties.color,
                                    transition: 'all 0.2s ease-in-out',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    textAlign: 'center',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontSize: '15px'
                                }}
                            >
                                {point.properties.name}
                            </button>
                        ))}
                    </div>
                ) : (
                    <p style={{
                        color: '#6b7280',
                        textAlign: 'center',
                        padding: '16px 0'
                    }}>No matching markers found.</p>
                )}
            </div>
        </div>
    );
}

export default MarkerPopup;
