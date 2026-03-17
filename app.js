// 获取相册图片（需用户选择，浏览器安全限制无法自动获取全部）
const LOCATION_HISTORY_KEY = 'locationHistory';
const MAX_HISTORY_AGE_MS = 24 * 60 * 60 * 1000; // 24小时
const DEDUPE_DISTANCE_M = 10; // 距离很近就合并
const DEDUPE_TIME_MS = 20 * 1000; // 20秒内合并

const STAY_RADIUS_M = 60; // 认为“同一地点”的半径
const STAY_MIN_DURATION_MS = 5 * 60 * 1000; // 停留至少5分钟才算停留点

const btnPhotos = document.getElementById('btnPhotos');
const btnLocation = document.getElementById('btnLocation');
const btnTrajectory = document.getElementById('btnTrajectory');
const fileInput = document.getElementById('fileInput');
const resultContent = document.getElementById('resultContent');
const mapOverlay = document.getElementById('mapOverlay');
const btnCloseMap = document.getElementById('btnCloseMap');

function pad2(n) { return String(n).padStart(2, '0'); }
function formatDateTime(ts) {
    const d = new Date(ts);
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function distanceMeters(aLat, aLng, bLat, bLng) {
    const R = 6371000;
    const toRad = (v) => v * Math.PI / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const lat1 = toRad(aLat);
    const lat2 = toRad(bLat);
    const sinDLat = Math.sin(dLat / 2);
    const sinDLng = Math.sin(dLng / 2);
    const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function getLocationHistory() {
    try {
        const raw = localStorage.getItem(LOCATION_HISTORY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

function savePosition(lat, lng, acc = null) {
    const list = getLocationHistory();
    const now = Date.now();

    const last = list.length ? list[list.length - 1] : null;
    if (last) {
        const dt = now - (last.ts || 0);
        const dist = distanceMeters(last.lat, last.lng, lat, lng);
        if (dt <= DEDUPE_TIME_MS && dist <= DEDUPE_DISTANCE_M) {
            // 合并：更新最后一个点的时间/精度，避免轨迹点过密
            last.ts = now;
            last.lat = lat;
            last.lng = lng;
            if (acc !== null && acc !== undefined) last.acc = acc;
        } else {
            list.push({ lat, lng, ts: now, acc });
        }
    } else {
        list.push({ lat, lng, ts: now, acc });
    }

    const cutoff = now - MAX_HISTORY_AGE_MS;
    const filtered = list.filter(p => p.ts >= cutoff);
    localStorage.setItem(LOCATION_HISTORY_KEY, JSON.stringify(filtered));
}

function getLast24hPositions() {
    const list = getLocationHistory();
    const cutoff = Date.now() - MAX_HISTORY_AGE_MS;
    return list.filter(p => p.ts >= cutoff).sort((a, b) => a.ts - b.ts);
}

btnPhotos.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) {
        showResult('resultContent', '未选择任何图片');
        return;
    }
    
    let html = `<h3>已选择 ${files.length} 张图片</h3>`;
    html += '<div class="photo-grid">';
    
    for (let i = 0; i < Math.min(files.length, 9); i++) {
        const url = URL.createObjectURL(files[i]);
        html += `<img src="${url}" alt="图片${i + 1}">`;
    }
    
    if (files.length > 9) {
        html += `<div style="grid-column:1/-1;text-align:center;padding:12px">还有 ${files.length - 9} 张未显示</div>`;
    }
    html += '</div>';
    html += `<div class="status success">共 ${files.length} 张图片</div>`;
    
    resultContent.innerHTML = html;
    fileInput.value = '';
});

let watchId = null;

btnLocation.addEventListener('click', () => {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        btnLocation.textContent = '监听现在所在位置';
        showResult('resultContent', '已停止位置监听');
        return;
    }

    if (!navigator.geolocation) {
        showResult('resultContent', '您的浏览器不支持地理定位', 'error');
        return;
    }

    resultContent.innerHTML = '<div class="status info">正在获取位置权限...</div>';

    const options = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
    };

    const updateLocation = (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const accNum = typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null;
        savePosition(lat, lng, accNum);
        const acc = pos.coords.accuracy ? pos.coords.accuracy.toFixed(1) : '-';
        const time = new Date().toLocaleTimeString('zh-CN');
        
        const mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
        const bdUrl = `https://api.map.baidu.com/marker?location=${lat},${lng}&title=当前位置`;
        
        resultContent.innerHTML = `
            <h3>📍 当前位置</h3>
            <div class="status success">纬度: ${lat}<br>经度: ${lng}<br>精度: ±${acc}米</div>
            <div class="status info" style="margin-top:8px">更新时间: ${time}</div>
            <p style="margin-top:12px;font-size:0.85rem">
                <a href="${mapUrl}" target="_blank" style="color:#00d9ff">在Google地图查看</a><br>
                <a href="https://uri.amap.com/marker?position=${lng},${lat}" target="_blank" style="color:#00d9ff">在高德地图查看</a>
            </p>
        `;
    };

    const onError = (err) => {
        let msg = '';
        switch (err.code) {
            case 1: msg = '用户拒绝了位置权限'; break;
            case 2: msg = '无法获取位置信息'; break;
            case 3: msg = '获取位置超时'; break;
            default: msg = '发生未知错误';
        }
        resultContent.innerHTML = `<div class="status error">${msg}</div>`;
        watchId = null;
        btnLocation.textContent = '监听现在所在位置';
    };

    watchId = navigator.geolocation.watchPosition(updateLocation, onError, options);
    btnLocation.textContent = '停止监听位置';
});

// 24小时轨迹：地图展示
let trajectoryMap = null;

function computeStayPoints(points) {
    // points: [{lat,lng,ts}]
    if (!points || points.length < 2) return [];
    const stays = [];

    let cluster = [];
    let center = null; // {lat,lng}

    const flushCluster = () => {
        if (cluster.length < 2) { cluster = []; center = null; return; }
        const startTs = cluster[0].ts;
        const endTs = cluster[cluster.length - 1].ts;
        const duration = endTs - startTs;
        if (duration >= STAY_MIN_DURATION_MS) {
            // 计算中心点（平均值）
            let sumLat = 0, sumLng = 0;
            for (const p of cluster) { sumLat += p.lat; sumLng += p.lng; }
            const lat = sumLat / cluster.length;
            const lng = sumLng / cluster.length;
            stays.push({ lat, lng, startTs, endTs, durationMs: duration, samples: cluster.length });
        }
        cluster = [];
        center = null;
    };

    for (const p of points) {
        if (!center) {
            cluster = [p];
            center = { lat: p.lat, lng: p.lng };
            continue;
        }
        const dist = distanceMeters(center.lat, center.lng, p.lat, p.lng);
        if (dist <= STAY_RADIUS_M) {
            cluster.push(p);
            // 平滑中心
            const n = cluster.length;
            center.lat = center.lat + (p.lat - center.lat) / n;
            center.lng = center.lng + (p.lng - center.lng) / n;
        } else {
            flushCluster();
            cluster = [p];
            center = { lat: p.lat, lng: p.lng };
        }
    }
    flushCluster();

    // 合并紧邻的停留点（避免抖动拆成多个点）
    const merged = [];
    for (const s of stays) {
        const prev = merged.length ? merged[merged.length - 1] : null;
        if (!prev) { merged.push(s); continue; }
        const dist = distanceMeters(prev.lat, prev.lng, s.lat, s.lng);
        const gap = s.startTs - prev.endTs;
        if (dist <= STAY_RADIUS_M && gap <= 10 * 60 * 1000) {
            // 合并
            const totalSamples = prev.samples + s.samples;
            prev.lat = (prev.lat * prev.samples + s.lat * s.samples) / totalSamples;
            prev.lng = (prev.lng * prev.samples + s.lng * s.samples) / totalSamples;
            prev.endTs = Math.max(prev.endTs, s.endTs);
            prev.startTs = Math.min(prev.startTs, s.startTs);
            prev.durationMs = prev.endTs - prev.startTs;
            prev.samples = totalSamples;
        } else {
            merged.push(s);
        }
    }
    return merged;
}

function formatDuration(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (h <= 0) return `${m}分钟`;
    if (m === 0) return `${h}小时`;
    return `${h}小时${m}分钟`;
}

btnTrajectory.addEventListener('click', () => {
    const points = getLast24hPositions();
    if (points.length < 2) {
        showResult('resultContent', '过去24小时轨迹点不足（至少2个点）。请先开启「监听现在所在位置」并移动一段时间后再查看。', 'info');
        return;
    }
    mapOverlay.classList.add('show');
    setTimeout(() => {
        if (trajectoryMap) trajectoryMap.remove();
        const latlngs = points.map(p => [p.lat, p.lng]);
        const center = latlngs[Math.floor(latlngs.length / 2)];
        trajectoryMap = L.map('trajectoryMap').setView(center, 14);
        // 高德底图（国内可访问）。说明：使用公开瓦片服务，不需要 key。
        L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&style=7&x={x}&y={y}&z={z}', {
            subdomains: ['1', '2', '3', '4'],
            maxZoom: 19
        }).addTo(trajectoryMap);

        const line = L.polyline(latlngs, { color: '#00d9ff', weight: 5, opacity: 0.85 }).addTo(trajectoryMap);
        L.marker(latlngs[0]).addTo(trajectoryMap).bindPopup('起点');
        L.marker(latlngs[latlngs.length - 1]).addTo(trajectoryMap).bindPopup('终点');

        // 停留点
        const stays = computeStayPoints(points);
        stays.forEach((s, idx) => {
            const label = String(idx + 1);
            const icon = L.divIcon({
                className: '',
                html: `<div style="width:26px;height:26px;border-radius:13px;background:#7c3aed;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid rgba(255,255,255,0.9)">${label}</div>`,
                iconSize: [26, 26],
                iconAnchor: [13, 13]
            });
            const popup = `停留点${label}<br>${formatDateTime(s.startTs)} → ${formatDateTime(s.endTs)}<br>停留：${formatDuration(s.durationMs)}`;
            L.marker([s.lat, s.lng], { icon }).addTo(trajectoryMap).bindPopup(popup);
        });

        // 同时在下方结果区列出停留点（方便不点地图也能看）
        if (stays.length) {
            let html = `<h3>🧭 过去24小时停留点（${stays.length}个）</h3>`;
            stays.slice(0, 20).forEach((s, idx) => {
                html += `<div class="status info">#${idx + 1} ${formatDateTime(s.startTs)} → ${formatDateTime(s.endTs)}（${formatDuration(s.durationMs)}）</div>`;
            });
            if (stays.length > 20) html += `<div class="status info">还有 ${stays.length - 20} 个停留点未显示</div>`;
            resultContent.innerHTML = html;
        } else {
            resultContent.innerHTML = `<div class="status info">过去24小时没有识别到明显停留点（需在同一地点停留≥${Math.floor(STAY_MIN_DURATION_MS / 60000)}分钟）。</div>`;
        }

        trajectoryMap.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30] });
    }, 100);
});

btnCloseMap.addEventListener('click', () => {
    mapOverlay.classList.remove('show');
    if (trajectoryMap) {
        trajectoryMap.remove();
        trajectoryMap = null;
    }
});

function showResult(id, text, type = 'info') {
    const el = document.getElementById(id);
    el.innerHTML = `<div class="status ${type}">${text}</div>`;
}
