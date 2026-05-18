const fs = require('fs');
const turf = require('@turf/turf');

// The 10 zones with their centers (lng, lat for turf)
const zones = [
    { id: 1, name: "Hebbal / Yelahanka", lat: 13.1005, lng: 77.5963 },
    { id: 2, name: "Yeshwanthpur / Peenya", lat: 13.0300, lng: 77.5200 },
    { id: 3, name: "Malleshwaram / Rajajinagar", lat: 13.0035, lng: 77.5700 },
    { id: 4, name: "Central / MG Road", lat: 12.9758, lng: 77.6063 },
    { id: 5, name: "Indiranagar / Domlur", lat: 12.9784, lng: 77.6408 },
    { id: 6, name: "Whitefield / Marathahalli", lat: 12.9591, lng: 77.6974 },
    { id: 7, name: "HSR / Sarjapur", lat: 12.9121, lng: 77.6446 },
    { id: 8, name: "Jayanagar / JP Nagar", lat: 12.9063, lng: 77.5857 },
    { id: 9, name: "Bannerghatta / Electronic City", lat: 12.8879, lng: 77.5969 },
    { id: 10, name: "RR Nagar / Kengeri", lat: 12.9274, lng: 77.5156 }
];

// Create turf points
const points = turf.featureCollection(
    zones.map(z => turf.point([z.lng, z.lat], {
        zone_id: z.id,
        name: z.name,
        center_lat: z.lat,
        center_lng: z.lng
    }))
);

// Define bounding box for Bangalore [minLng, minLat, maxLng, maxLat]
// from app.js bounding logic: lat 12.7 to 13.25, lon 77.3 to 77.85
const options = {
    bbox: [77.3, 12.7, 77.85, 13.25]
};

// Generate Voronoi Polygons
const voronoiPolygons = turf.voronoi(points, options);

// Turf.voronoi returns polygons in the exact same order as the input points
// but the properties are stripped. We need to re-attach them.
voronoiPolygons.features.forEach((feature, index) => {
    // If a point is on the edge, it might not generate a polygon depending on bbox,
    // but our bbox covers all points well.
    if (feature) {
        feature.properties = points.features[index].properties;
    }
});

// Remove any null features (shouldn't be any)
voronoiPolygons.features = voronoiPolygons.features.filter(f => f !== null);

// Write back to bangalore_zones.geojson
fs.writeFileSync('bangalore_zones.geojson', JSON.stringify(voronoiPolygons, null, 2));
console.log("Successfully generated perfect Voronoi tiling for bangalore_zones.geojson");
