import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

export interface Coord { lat: number; lng: number; }

interface Props {
  boardCoord:   Coord | null;
  deboardCoord: Coord | null;
  breadcrumbs:  Coord[];
  style?:       StyleProp<ViewStyle>;
}

function buildHtml(board: Coord | null, deboard: Coord | null, crumbs: Coord[]): string {
  const allCoords = [board, ...crumbs, deboard].filter(Boolean) as Coord[];

  // Centre on first available point, fallback to Bengaluru
  const centre  = allCoords[0] ?? { lat: 12.9716, lng: 77.5946 };
  const zoom    = allCoords.length > 1 ? 15 : 16;

  const boardJs   = board   ? `[${board.lat},${board.lng}]`   : 'null';
  const deboardJs = deboard ? `[${deboard.lat},${deboard.lng}]` : 'null';
  const crumbsJs  = JSON.stringify(crumbs.map(c => [c.lat, c.lng]));

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body,#map { width:100%; height:100%; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function(){
  var map = L.map('map',{zoomControl:false,attributionControl:true})
             .setView([${centre.lat},${centre.lng}],${zoom});

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom:19
  }).addTo(map);

  function dot(color,size){
    return L.divIcon({
      html:'<div style="width:'+size+'px;height:'+size+'px;border-radius:50%;background:'+color+';border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
      iconSize:[size,size],iconAnchor:[size/2,size/2],className:''
    });
  }

  var boardCoord   = ${boardJs};
  var deboardCoord = ${deboardJs};
  var breadcrumbs  = ${crumbsJs};

  if(boardCoord)   L.marker(boardCoord,  {icon:dot('#00A651',18)}).addTo(map).bindPopup('Boarded');
  if(deboardCoord) L.marker(deboardCoord,{icon:dot('#E53935',18)}).addTo(map).bindPopup('Deboarded');

  // Full route: board → breadcrumbs → deboard
  var route = [];
  if(boardCoord)   route.push(boardCoord);
  breadcrumbs.forEach(function(c){ route.push(c); });
  if(deboardCoord) route.push(deboardCoord);

  if(route.length>1){
    L.polyline(route,{color:'#FFD000',weight:4,opacity:0.9}).addTo(map);
  }

  // Fit all points
  var all = route.slice();
  if(boardCoord && route.indexOf(boardCoord)<0) all.push(boardCoord);
  if(all.length>1){
    map.fitBounds(L.latLngBounds(all),{padding:[32,32],maxZoom:17});
  }
})();
</script>
</body>
</html>`;
}

export default function TripMap({ boardCoord, deboardCoord, breadcrumbs, style }: Props) {
  const html = buildHtml(boardCoord, deboardCoord, breadcrumbs);
  return (
    <View style={[styles.container, style]}>
      <WebView
        source={{ html }}
        style={styles.webview}
        originWhitelist={['*']}
        scrollEnabled={false}
        javaScriptEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  webview:   { flex: 1, backgroundColor: 'transparent' },
});
