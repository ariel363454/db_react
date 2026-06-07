import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup, Circle, Tooltip, useMapEvents, FeatureGroup } from 'react-leaflet';
import axios from 'axios';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { createPortal } from 'react-dom';


const parseWKTToLatLng = (wktStr) => {
  if (!wktStr || typeof wktStr !== 'string') return [];
  
  const text = wktStr.toUpperCase().trim();
  const numberPattern = /-?\d+\.\d+|-?\d+/g;

  if (text.startsWith('MULTILINESTRING')) {
    const lineStrings = text.split(/\),\s*\(/);
    const multiCoords = [];

    lineStrings.forEach(line => {
      const matches = line.match(numberPattern);
      if (!matches || matches.length < 2) return;
      
      const singleLineCoords = [];
      for (let i = 0; i < matches.length; i += 2) {
        const val1 = parseFloat(matches[i]);
        const val2 = parseFloat(matches[i + 1]);
        if (val2 >= 20 && val2 <= 26 && val1 >= 119 && val1 <= 123) {
          singleLineCoords.push([val2, val1]);
        } else if (val1 >= 20 && val1 <= 26 && val2 >= 119 && val2 <= 123) {
          singleLineCoords.push([val1, val2]);
        }
      }
      if (singleLineCoords.length >= 2) {
        multiCoords.push(singleLineCoords);
      }
    });
    return multiCoords;
  }

  // 🚀 劇本 B：一般的 LINESTRING (維持你原本的優秀邏輯)
  const matches = text.match(numberPattern);
  if (!matches || matches.length < 2) return [];
  
  const coords = [];
  for (let i = 0; i < matches.length; i += 2) {
    const val1 = parseFloat(matches[i]);
    const val2 = parseFloat(matches[i + 1]);
    if (val2 >= 20 && val2 <= 26 && val1 >= 119 && val1 <= 123) {
      coords.push([val2, val1]);
    } else if (val1 >= 20 && val1 <= 26 && val2 >= 119 && val2 <= 123) {
      coords.push([val1, val2]);
    }
  }
  return coords;
};

const getAvailabilityColor = (avaCar) => {
  if (avaCar === null || avaCar === undefined || avaCar === '') return '#BDC3C7';
  const count = parseInt(avaCar, 10);
  if (isNaN(count)) return '#BDC3C7'; 

  if (count > 3) return '#6B9E78';
  if (count >= 1 && count <= 3) return '#E67E22';
  if (count === 0) return '#C96B5C';
  return '#BDC3C7';
};

const getAvailabilityTextOpacity = (avaCar) => {
  if (avaCar === null || avaCar === undefined || avaCar === '') return 0.6;
  const count = parseInt(avaCar, 10);
  if (isNaN(count)) return 0.6;

  if (count > 3) return 0.8;
  if (count >= 1 && count <= 3) return 0.6;
  if (count === 0) return 0.72;
  return 0.6; 
};
let globalDebounceTimer;

function App() {
  const [parkingItems, setParkingItems] = useState([]);
  const [isRadiusMode, setIsRadiusMode] = useState(false);
  const [userLocation, setUserLocation] = useState(null);
  const [map, setMap] = useState(null);
  const [activeFeeItem, setActiveFeeItem] = useState(null);
  const [selectedDistrict, setSelectedDistrict] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [lastUpdateTime, setLastUpdateTime] = useState('');
  const [timeMode, setTimeMode] = useState('now');
  const [isLegendOpen, setIsLegendOpen] = useState(false);
  const [targetTime, setTargetTime] = useState(() => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
  });
  useEffect(() => {
    if (timeMode !== 'now') return;

    const updateToPresent = () => {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const nowFormatted = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
      setTargetTime(nowFormatted);
      
      if (map) {
        map.fire('dragend'); 
      }
    };

    updateToPresent();
    const timer = setInterval(updateToPresent, 30000);
    return () => clearInterval(timer); 
  }, [timeMode, map]);

  // 🎯 時空連動監聽：自訂時間選完的那一秒，立刻命令地圖刷費率
  useEffect(() => {
    if (map) {
      map.fire('dragend');
    }
  }, [targetTime, map]);
  const handleSearch = async (district, keyword) => {
      if (!keyword.trim()) {
          alert("請輸入要搜尋的地標、路名或地址！");
          return;
      }
      let fullAddress = '';
      if (keyword.includes('區') || keyword.includes('市') || keyword.includes('台北')) {
          fullAddress = keyword.startsWith('台北') ? keyword : `台北市${keyword}`;
      }
      else {
          fullAddress = `台北市${district}${keyword}`;
          
          if (keyword === '台北101' || keyword === '台北車站' || keyword.length < 5) {
              fullAddress = `台北市${keyword}`;
          }
      }

      console.log(`📡 [智能地址對齊] 最終發送給 OSM 的反查字串為: "${fullAddress}"`);
      
      try {
          // 1. 第三方地理反查
          const response = await fetch(
              `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(fullAddress)}&format=json&limit=1`
          );
          const data = await response.json();
          
          if (data && data.length > 0) {
              const newLat = parseFloat(data[0].lat);
              const newLng = parseFloat(data[0].lon);
              
              console.log(`成功反查中心點：緯度 ${newLat}, 經度 ${newLng}`);

              // 🚀 同步設定中心點，讓地圖上的 500m 藍色虛線圈圈自動畫在 101 周圍
              setUserLocation({ lat: newLat, lng: newLng });
              setIsRadiusMode(true);

              // 2. 叫 Leaflet 地圖直接飛過去！
              if (map) {
                  map.flyTo([newLat, newLng], 16);
              }

              // 3. 帶著新中心點，去敲你們昨天修好的 Django 後端 API
              const apiURL = `https://db-tp-back-api-bwhwd8dgfudjbgek.eastasia-01.azurewebsites.net/api/parking_bounds/?min_lat=${newLat-0.01}&max_lat=${newLat+0.01}&min_lng=${newLng-0.01}&max_lng=${newLng+0.01}&user_lat=${newLat}&user_lng=${newLng}`;
              
              const backendRes = await fetch(apiURL);
              const backendData = await backendRes.json();
              
              // 4. 更新地圖上的停車格
              setParkingItems(backendData); 

          } else {
              alert("找不到這個地方，請重新輸入！");
          }
      } catch (error) {
          console.error("地理反查或連線後端出錯:", error);
      }
  };

  const MapEvents = () => {
    const mapInstance = useMapEvents({
      dragend: () => handleMapChange(),
      zoomend: () => handleMapChange(),
    });

    const handleMapChange = () => {
      clearTimeout(globalDebounceTimer);

      globalDebounceTimer = setTimeout(() => {
        if (!mapInstance) return;
        
        try {
          if (!isRadiusMode && mapInstance.getZoom() < 16) {
            console.log("🛑 [效能防禦] 級距過小，直接清空陣列，拒絕請求後端，保護記憶體。");
            setParkingItems([]); // 一秒清空，DOM 節點瞬間蒸發
            return; // 直接攔截，不發送 Axios 請求！
          }
          const bounds = mapInstance.getBounds();
          let params = {};

          if (isRadiusMode && userLocation) {
            params = {
              min_lat: userLocation.lat - 0.0045,
              max_lat: userLocation.lat + 0.0045,
              min_lng: userLocation.lng - 0.0050,
              max_lng: userLocation.lng + 0.0050,
              user_lat: userLocation.lat,
              user_lng: userLocation.lng,
              target_time: targetTime,
            };
          } else {
            params = {
              min_lat: bounds.getSouth(),
              max_lat: bounds.getNorth(),
              min_lng: bounds.getWest(),
              max_lng: bounds.getEast(),
              target_time: targetTime,
            };
          }

          console.log("📡 [緩衝盾牌生效] 視域完全靜止，發送單一請求...", params);

          axios.get('https://db-tp-back-api-bwhwd8dgfudjbgek.eastasia-01.azurewebsites.net/api/parking_bounds/', { params })
            .then((res) => {
              if (res.data) {
                console.log("✅ 成功獲取後端異質資料筆數:", res.data.length);
                setParkingItems(res.data);
                const backendTime = res.data[0].update_time || res.data[0]['update-time'];
                
                if (backendTime) {
                  const formattedTime = backendTime.includes(' ') 
                    ? backendTime.split(' ')[1].slice(0, 5) 
                    : backendTime.slice(0, 5);

                  setLastUpdateTime(formattedTime);
                }
              }
            })
            .catch((err) => console.error("❌ API 撈取失敗:", err));
            
        } catch (e) {
          console.warn("⚠️ 攔截到動畫重繪暫時性異常，已自動屏蔽以防止白屏:", e);
        }
      }, 400);
    };

    return null;
  };

const handleSearchNearby = (mapInstance) => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = 25.0478;
          const lng = 121.5170;
          
          console.log("🎯 [Demo Mock 模式啟用] 已模擬使用者位於台北車站");
          
          setUserLocation({ lat, lng });
          setIsRadiusMode(true);
          
          if (mapInstance) {
            setTimeout(() => {
              mapInstance.flyTo([lat, lng], 16);
              const url = `https://db-tp-back-api-bwhwd8dgfudjbgek.eastasia-01.azurewebsites.net/api/parking_bounds/?min_lat=${lat-0.0045}&max_lat=${lat+0.0045}&min_lng=${lng-0.0050}&max_lng=${lng+0.0050}&user_lat=${lat}&user_lng=${lng}&target_time=${targetTime}`;
              axios.get(url).then(res => setParkingItems(res.data)).catch(err => console.error(err));
            }, 150);
          }
        },
        (err) => {
          console.warn("⚠️ 攔截到 GPS 獲取失敗，啟動備用 Demo 機制");
          const lat = 25.0478;
          const lng = 121.5170;
          
          setUserLocation({ lat, lng });
          setIsRadiusMode(true);
          
          if (mapInstance) {
            setTimeout(() => {
              mapInstance.flyTo([lat, lng], 16);
              const url = `https://db-tp-back-api-bwhwd8dgfudjbgek.eastasia-01.azurewebsites.net/api/parking_bounds/?min_lat=${lat-0.0045}&max_lat=${lat+0.0045}&min_lng=${lng-0.0050}&max_lng=${lng+0.0050}&user_lat=${lat}&user_lng=${lng}&target_time=${targetTime}`;
              axios.get(url).then(res => setParkingItems(res.data)).catch(err => console.error(err));
            }, 150);
          }
        }
      );
    } else {
      const lat = 25.0478;
      const lng = 121.5170;
      setUserLocation({ lat, lng });
      setIsRadiusMode(true);
      if (mapInstance){
        mapInstance.flyTo([lat, lng], 16);
        const url = `https://db-tp-back-api-bwhwd8dgfudjbgek.eastasia-01.azurewebsites.net/api/parking_bounds/?min_lat=${lat-0.0045}&max_lat=${lat+0.0045}&min_lng=${lng-0.0050}&max_lng=${lng+0.0050}&user_lat=${lat}&user_lng=${lng}&target_time=${targetTime}`;
        axios.get(url).then(res => setParkingItems(res.data)).catch(err => console.error(err));
      }
      
    }
  };

  const handleResetToGlobal = (mapInstance) => {
    setIsRadiusMode(false);
    setUserLocation(null);
    setSearchKeyword('');
    console.log("🌐 [自由瀏覽模式] 已解除 500m 半徑精篩，恢復全圖視野");
  };

  return (
      <div className="app-container relative w-full h-[100vh] flex flex-col" style={{ margin: 0, padding: 0, overflow: 'hidden', touchAction: 'none' }}>      <div 
        className="absolute left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center w-auto max-w-[95vw]"
        style={{ 
          top: '15px',
          rowGap: '12px',
          left: '48%',
        }} 
      >
        {/* 🔍 高質感黑白膠囊搜尋框體 */}
        <div 
          className="flex flex-row items-center overflow-hidden"
          style={{
            position: 'relative',
            backgroundColor: 'rgba(255,255,255,0.9)', 
            border: '1px solid rgba(255,255,255,0.5)',
            backdropFilter: 'blur(12px)',
            borderRadius: '24px',
            boxShadow: '0 4px 12px rgba(15,23,42,0.05)',
            padding: '0px 16px',
            width: '100%',
            minWidth: window.innerWidth > 640 ? '680px' : '330px',
            height: '48px',
            marginBottom: '10px'
          }}
        >
          {/* 1. 行政區下拉選單 */}
          <select
            value={selectedDistrict}
            onChange={(e) => setSelectedDistrict(e.target.value)}
            className="text-base sm:text-xs font-bold text-gray-700 bg-transparent outline-none cursor-pointer px-3 py-1.5"
            style={{ 
              border: '0px solid rgba(0,0,0,0.08)',
              borderRight: '1px solid #E5E7EB',
              color: '#4b5563',
              backgroundColor: 'transparent',
              padding: '6px 28px 6px 12px',
              outline: 'none',
              cursor: 'pointer',
              appearance: 'none',
              WebkitAppearance: 'none',
              backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='join'><polyline points='6 9 12 15 18 9'></polyline></svg>")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 8px center',
              backgroundSize: '14px'
            }}
          >
            <option value="">不限行政區</option>
            {['中正區', '萬華區', '大同區', '中山區', '大安區', '信義區', '松山區', '內湖區', '南港區', '士林區', '北投區', '文山區'].map(dist => (
              <option key={dist} value={dist}>{dist}</option>
            ))}
          </select>

          {/* 2. 地標路名打字輸入框 */}
          <input 
            type="text"
            placeholder="搜尋路名、地標"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            /* 🚀 用 w-full 和 min-w-0，配合 flex-1，讓它在手機上自動縮小、在電腦上自動拉長，放大鏡絕對不會被擠飛！ */
            className="text-base sm:text-sm bg-transparent outline-none px-2 flex-1 w-full min-w-0 text-gray-800 placeholder:text-[#9ca3af]"
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(selectedDistrict, searchKeyword); }}
            style={{
              color: '#1F2937',
              opacity: '0.75',
              border: '0px',
              borderRight: '1px solid #E5E7EB',
              fontWeight: '400',
              marginLeft: '8px',
              paddingRight: '45px', /* 縮小右邊距，留位置給更新時間 */
            }}
          />
          {/* 🕒 【全新植入】搜尋框內建右下角更新時間 */}
          <div 
            style={{
              position: 'absolute',
              right: '70px',       // 🚀 剛好卡在放大鏡按鈕的左邊
              bottom: '4px',       // 下移一點點，靠緊底邊
              fontSize: '10px',    // 再縮小一個級距，變成精緻的點綴字
              fontWeight: '400',
              color: '#9ca3af',
              opacity: '0.75',
              userSelect: 'none',  
              pointerEvents: 'none',
            }}
          >
            更新 {lastUpdateTime}
          </div>

          {/* 3. 膠囊小搜尋按鈕 */}
          <button 
            onClick={() => handleSearch(selectedDistrict, searchKeyword)}
            className="cursor-pointer transition-all active:scale-95 flex items-center justify-center"
            style={{
              backgroundColor: 'rgba(15,23,42,0.04)', 
              
              width: '18px',
              height: '18px',
              borderRadius: '18px',
              marginLeft: '10px',
              border: 'none',
              padding: '0',
              boxShadow: '0 2px 6px rgba(79, 70, 229, 0.2)',
            }}
          >
            {/* 🔍 放大鏡 Outline Icon 本體 (標準線性極簡風) */}
            <svg 
              className="w-5 h-5" // Tailwind 控制預設大小
              viewBox="0 0 24 24" 
              fill="none" 
              strokeLinecap="round" 
              strokeLinejoin="round"
              style={{
                // 🎨 3. 【Icon 顏色】在這裡調！目前是純白（若按鈕背景是透明，這裡可以改成深灰 #374151 或橘色）
                stroke: '#9CA3AF', 
                
                // 📐 4. 【Icon 線條粗細】在這裡調！數字越大越粗（2.5 剛剛好，想要極細科技風可以改 1.8）
                strokeWidth: '2.5', 
                
                // 📐 5. 【Icon 畫面大小】也可以在這裡精確微調
                width: '18px',
                height: '18px'
              }}
            >
              {/* 放大鏡的正圓圈圈 */}
              <circle cx="11" cy="11" r="8"></circle>
              {/* 放大鏡的斜握柄 */}
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </button>
        </div>
       {/* 🚀 雙子星貨櫃：強行將「時間篩選」與「範圍切換」橫向肩並肩排開 */}
        <div
          className="space-time-twin-controls w-full flex flex-row justify-center"
          style={{
            display: 'flex',
            flexDirection: 'row',     /* 🚀 電腦跟手機一律維持橫向並排！ */
            alignItems: 'center',
            gap: '8px',               /* 縮小間距，讓手機塞得下 */
            width: '100%',
            maxWidth: '720px',        /* 完美對齊上方搜尋框 */
            boxSizing: 'border-box',
            padding: '0 4px'
          }}
        >
          
          {/* ❶ 左側：【260px 極簡文字切換完全體】 */}
          <div
            className="time-filter-section"
            style={{
              backgroundColor: 'rgba(255,255,255,0.85)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              borderRadius: '999px', 
              padding: '10px',      
              boxShadow: '0 2px 8px rgba(15,23,42,0.05)',
              border: '1px solid #e5e7eb',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              width: window.innerWidth > 640 ?'220px' : '100%',
              height: '40px',
              boxSizing: 'border-box',
            }}
          >
            {/* 📅 一體化純文字智慧點擊長條框 */}
            <div
              className="interactive-text-toggle-bar"
              onClick={() => {
                if (timeMode === 'custom') {
                  setTimeMode('now');
                  const now = new Date();
                  const pad = (n) => String(n).padStart(2, '0');
                  const formatted = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
                  setTargetTime(formatted);
                } else {
                  // 🚀 如果是現在時間模式，戳下去強制命令底層 input 喚醒原生轉盤！
                  const inputEl = document.getElementById('ghost-time-input');
                  if (inputEl && inputEl.showPicker) {
                    setTimeMode('custom'); // 變更狀態解鎖時間字串顯示
                    inputEl.showPicker();  // 流暢拉出大轉盤
                  }
                }
              }}
              style={{
                width: '100%',
                height: '100%', 
                background: 'rgba(255, 255, 255, 0.6)',
                border: '0px solid rgba(0,0,0,0.05)',
                borderRadius: '10px',
                padding: '0 10px', 
                display: 'flex',
                alignItems: 'center',
                boxSizing: 'border-box',
                position: 'relative',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              <input
                id="ghost-time-input"
                type="datetime-local"
                value={targetTime.replace(' ', 'T').substring(0, 16)}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const formatted = e.target.value.replace('T', ' ') + ':00';
                  setTargetTime(formatted);
                  if (map) map.fire('dragend');
                }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  margin: 0,
                  padding: 0,
                  border: 'none',
                  boxSizing: 'border-box',
                  background: 'transparent',
                  
                  // 🚀 關鍵雙軌制：
                  // 如果是手機版（螢幕寬度小於 640px），讓 input 變滿版實體，直接去吃手指的點擊！
                  // 如果是電腦版，維持原本的隱形狀態
                  width: window.innerWidth < 640 ? '100%' : '1px',
                  height: window.innerWidth < 640 ? '100%' : '1px',
                  opacity: window.innerWidth < 640 ? 0.01 : 0, // 0.01 騙過 Safari，肉眼完全看不見
                  zIndex: window.innerWidth < 640 ? 10 : -1,  // 手機版蓋在文字上方，電腦版退到後方
                  pointerEvents: window.innerWidth < 640 ? 'auto' : 'none', // 手機版允許點擊
                }}
              />

              <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                stroke={'#4338CA'} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                style={{ flexShrink: 0, marginRight: '8px', transition: 'stroke 0.2s ease' }}
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>

              <div
                style={{
                  fontSize: '13px', 
                  fontWeight: '500',
                  userSelect: 'none',
                  color: '#4b5563', 
                  transition: 'all 0.2s ease',
                  whiteSpace: 'nowrap', 
                }}
              >
                {timeMode === 'now' ? (
                  '現在時間'
                ) : (
                  (() => {
                    if (!targetTime) return '';
                    const [datePart, timePart] = targetTime.split(' ');
                    const shortDate = datePart.substring(2).replace(/-/g, '/'); 
                    const [hour, min] = timePart.split(':');
                    return `${shortDate} ${hour}:${min}`; 
                  })()
                )}
              </div>
              
            </div>

            
          </div>

          {/* ❷ 右側：【260px 搜尋範圍智慧膠囊滑塊】 */}
          <div 
            className="search-range-section"
            style={{
              backgroundColor: 'rgba(79,70,229,0.08)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              borderRadius: '999px',
              padding: '3px',      // 🚀 讓右邊大盒子的 Padding 與左邊完全一致！
              boxShadow: '0 4px 12px rgba(15,23,42,0.06)',
              border: '1px solid rgba(255,255,255,0.5)',
              display: 'flex',
              flexDirection: 'column',
              width: window.innerWidth > 640 ?'220px' : '100%',
              height: '40px',       // 讓高度自動適應
              boxSizing: 'border-box',
            }}
          >
            {/* 內部的膠囊滑塊按鈕組 */}
            <div
              style={{
                width: '100%',
                height: '38px',     // 🚀 完美對齊左邊長條框的 38px 高度！
                backgroundColor: 'rgba(79,70,229,0.08)', 
                borderRadius: '999px', // 完美對齊左邊的圓角
                padding: '3px',
                boxSizing: 'border-box',
                display: 'flex',
                flexDirection: 'row',
                userSelect: 'none',
              }}
            >
              {/* 500m 模式 */}
              <div
                onClick={() => { if (!isRadiusMode) handleSearchNearby(map); }}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  backgroundColor: isRadiusMode ? 'rgba(79,70,229,0.12)' : 'transparent',
                  color: isRadiusMode ? '#4338CA' : '#6B7280',
                  fontSize: '11px',
                  fontWeight: isRadiusMode ? '600' : '500',
                  borderRadius: '999px', // 微調內部滑塊圓角
                  boxShadow: isRadiusMode ? '0 1px 3px rgba(15,23,42,0.08)' : 'none',
                  gap: '4px'
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  {isRadiusMode ? (
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 7a3 3 0 1 0 0 6 3 3 0 1 0 0-6z" />
                  ) : (
                    <>
                      <circle cx="12" cy="12" r="10" />
                      <line x1="22" y1="12" x2="2" y2="12" />
                      <line x1="12" y1="6" x2="12" y2="2" />
                      <line x1="12" y1="22" x2="12" y2="18" />
                    </>
                  )}
                </svg>
                <span>500m模式</span>
              </div>

              {/* 自由瀏覽 */}
              <div
                onClick={() => { if (isRadiusMode) handleResetToGlobal(map); }}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  backgroundColor: !isRadiusMode ? 'rgba(79,70,229,0.12)' : 'transparent',
                  color: !isRadiusMode ? '#4338CA' : '#6B7280',
                  fontSize: '11px',
                  fontWeight: !isRadiusMode ? '600' : '500',
                  borderRadius: '999px',
                  boxShadow: !isRadiusMode ? '0 1px 3px rgba(15,23,42,0.08)' : 'none',
                  gap: '4px'
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                </svg>
                <span>自由瀏覽</span>
              </div>
            </div>

          </div>

        </div>
      </div>
      {/* 🚀 核心手術：利用 Tailwind 斷點，讓按鈕在手機和電腦自動切換左右邊！ */}
      <div
        className="absolute bottom-24 left-5 z-[1000] flex flex-col gap-0 shadow-md rounded-xl overflow-hidden"
        style={{
          position: 'absolute',
          bottom: '25px',
          left: '20px',
        }}
      >
        {/* ➕ 放大按鈕 */}
        <button
          onClick={() => map.zoomIn()} 
          className="font-bold text-slate-800 border-slate-200/80 cursor-pointer transition-all active:scale-90 flex items-center justify-center text-lg"
          style={{
            width: '40px',
            height: '40px',
            minHeight: '40px',
            minWidth: '40px',
            backgroundColor: 'rgba(255,255,255,0.86)',
            color: '#4B5563',
            border: '0px solid #4B5563',
            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.06)',
            borderRadius: '14px 14px 0 0', 
          }}
        >
          ＋
        </button>

        {/* ➖ 縮小按鈕 */}
        <button
          onClick={() => map.zoomOut()} 
          className="text-slate-800 border-slate-200/80 cursor-pointer transition-all active:scale-90 flex items-center justify-center text-lg"
          style={{
            width: '40px',
            height: '40px',
            minWidth: '40px',
            minHeight: '40px',
            backgroundColor: 'rgba(255,255,255,0.86)',
            color: '#4B5563',
            border: '0px solid #4B5563',
            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.06)',
            borderRadius: '0 0 14px 14px',
          }}
        >
          －
        </button>

      </div>
      {/* 🗺️ Leaflet 地圖主體容器 */}
      <MapContainer 
        center={[25.055, 121.523]} 
        zoom={15}
        zoomControl={false} 
        attributionControl={false}
        style={{ width: '100%', height: '100%' }}
        ref={setMap}
        preferCanvas={true}
        whenReady={(mapInstance) => {
          setTimeout(() => {
            mapInstance.target.invalidateSize();
          }, 100);
        }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />
        
        <MapEvents />

        {isRadiusMode && userLocation && (
          <React.Fragment>
            <Circle
              center={[userLocation.lat, userLocation.lng]}
              radius={5} // 實體 8 公尺小圓點，當作中心指針
              pathOptions={{
                fillColor: '#E07A5F', // Tailwind Red 500
                fillOpacity: 1,
                color: '#FFFFFF',
                weight: 2,
              }}
              renderer={L.svg()}
            />

            <Circle
              center={[userLocation.lat, userLocation.lng]}
              radius={500} // 📐 嚴格對齊後端 ST_Distance_Sphere 的 500 公尺！
              pathOptions={{
                fillColor: '#6366F1',   // Tailwind Blue 500
                fillOpacity: 0.05,     // 🌌 極致輕薄的半透明科技底色，絕對不遮擋馬路和圖標
                color: '#6366F1',
                opacity: '0.5',
                weight: 1,
                dashArray: '18, 12',     // ⚡ 讓圓形外框變虛線圈，視覺質感直接飛天！
              }}
              interactive={false}
              renderer={L.svg()}
            />
          </React.Fragment>
        )}
        {/* 🚀 智慧伸縮動態圖例膠囊完全體（徹底拔除 window.innerWidth 危害） */}
        <div 
          className="absolute z-[1000] flex flex-col items-end"
          style={{
            bottom: '25px',
            right: '20px',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)', 
          }}
        >
          {/* ❶ 負責觸發收合的「極簡浮動圓鈕」 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsLegendOpen(!isLegendOpen);
            }}
            className="flex items-center justify-center shadow-lg cursor-pointer transition-all active:scale-90"
            style={{
              width: '36px',
              height: '36px',
              backgroundColor: isLegendOpen ? '#4F46E5' : 'rgba(255,255,255,0.9)', 
              color: isLegendOpen ? '#FFFFFF' : '#4B5563',
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.6)',
              backdropFilter: 'blur(8px)',
              marginBottom: '6px', 
            }}
            title={isLegendOpen ? "關閉圖例" : "展開圖例"}
          >
            {isLegendOpen ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
            )}
          </button>

          {/* ❷ 圖例內容本體（鎖定尺寸，不再用 JS 算寬高，杜絕 Safari 縮小 Bug） */}
          <div 
            className="flex flex-col gap-2.5 rounded-xl tracking-wide border-slate-200/80 animate-fade-in"
            style={{
              width: '120px',
              // 🚀 當展開時是完美的 120px，收合時是 0px 藏起來
              height: isLegendOpen ? '100px' : '0px',
              opacity: isLegendOpen ? 1 : 0,
              pointerEvents: isLegendOpen ? 'auto' : 'none', 
              transform: isLegendOpen ? 'scale(1)' : 'scale(0.85)', 
              transformOrigin: 'bottom right',
              transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
              backgroundColor: 'rgba(255,255,255,0.82)',
              boxShadow: '0 4px 10px rgba(15,23,42,0.06)',
              border: '1px solid #FFFFFF30',
              borderRadius: '14px',
              userSelect: 'none',
              padding: isLegendOpen ? '10px 12px' : '0px 12px',
              overflow: 'hidden' 
            }}
          >
            {/* 停車場 */}
            <div className="flex items-center gap-8 text-[14px] font-bold" style={{ color: '#6B7280' }}>
              <div className="flex items-center justify-center w-6 h-4">
                <div style={{ width: '20px', height: '20px', backgroundColor: '#3730A3', borderRadius: '50% 50% 50% 20%', transform: 'rotate(-45deg)', marginTop: '1px', marginLeft: '10px', marginBottom: '10px' }} />
              </div>
              <span style={{ fontSize: '11px', marginLeft: '12.5px', marginBottom: '8px' , marginTop: '4px'}}>停車場</span>
            </div>

            {/* 黃線 */}
            <div className="flex items-center gap-8 text-[14px] font-bold" style={{ color: '#6B7280' }}>
              <div className="flex items-center justify-center w-6 h-4">
                <div style={{ width: '18px', height: '4px', backgroundColor: '#C9A227', borderRadius: '2px', marginLeft: '11px', marginBottom: '10px' }} />
              </div>
              <span style={{ fontSize: '11px', marginLeft: '12px', marginBottom: '10px' }}>黃線 (時段臨停)</span>
            </div>

            {/* 路邊可停 */}
            <div className="flex items-center gap-8 text-[14px] font-bold" style={{ color: '#6B7280' }}>
              <div className="flex items-center justify-center w-6 h-4">
                <div style={{ width: '18px', height: '4px', backgroundColor: '#6B9E78', borderRadius: '2px', marginLeft: '11px', marginBottom: '10px' }} />
              </div>
              <span style={{ fontSize: '11px', marginLeft: '12px', marginBottom: '10px' }}>路邊可停</span>
            </div>

            {/* 已滿 */}
            <div className="flex items-center gap-8 text-[14px] font-bold" style={{ color: '#6B7280' }}>
              <div className="flex items-center justify-center w-6 h-4">
                <div style={{ width: '18px', height: '4px', backgroundColor: '#C96B5C', borderRadius: '2px', marginLeft: '11px', marginBottom: '10px' }} />
              </div>
              <span style={{ fontSize: '11px', marginLeft: '12px', marginBottom: '10px' }}>路邊已滿</span>
            </div>
          </div>
        </div>

        {parkingItems.map((item, idx) => {
          if (!item || !item.type) return null;
          const currentZoom = map ? map.getZoom() : 15; // 抓不到時預設 15
          if (!isRadiusMode && currentZoom < 16) {
            return null; // 物理屏蔽，只留地圖本人
          }
          
          if (item.type === 'lot') {
            if (!item.latitude || !item.longitude) return null;
            const lat = parseFloat(item.latitude);
            const lng = parseFloat(item.longitude);
            if (isNaN(lat) || isNaN(lng)) return null;   

            return (
              <Marker 
                position={[lat, lng]} 
                icon={createOptimizedParkingIcon(item.ava_car, item.current_active_rate)}
                key={`lot-p-style-secure-${item.lot_id || item.id}`} // 🔒 身份鎖死，絕不白屏
              >
                <Popup
                  maxWidth={220}
                  minWidth={220}
                  autoPanPadding={[50, 50]}
                >
                  <div className="font-sans p-1" style={{ minWidth: '190px' }}>
                    {/* 🅿️ 1. 停車場名稱標題（與大彈窗同款線性方框） */}
                    <h3 className="text-sm font-bold flex items-center gap-1.5 m-0 mb-0" style={{ color: '#090d16', lineHeight: '1.4' }}>
                      <svg className="w-[1em] h-[1em] flex-shrink-0 inline-block align-text-bottom" style={{ color: '#4F46E5', marginRight: '2px' }} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="2" width="20" height="20" rx="4" />
                        <path d="M9 17V7h4a3 3 0 0 1 0 6H9" />
                      </svg>
                      <span>{item.lot_name || '未命名停車場'}</span>
                    </h3>

                    {/* 📍 2. 地址（極簡線性大頭針，微調對齊） */}
                    <p className="text-xs m-0 mb-1.5 flex items-center gap-1.5" style={{ color: '#6b7280' }}>
                      <svg className="w-[1.1em] h-[1.1em] flex-shrink-0" style={{ color: '#9ca3af', marginBottom: '-0.02em', marginRight: '2px'}} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      <span className="block truncate" title={item.addr}>{item.addr || '暫無地址資料'}</span>
                    </p>
                    {/* 🚀 2.5 核心位置增補：Google 地圖導航按鈕（緊貼在地址下方） */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        
                        // ❶ 智慧抓取中文名字（如果沒有場名，就抓地址或路段名）
                        const searchName = item.lot_name || item.road_name || item.addr;
                        
                        if (searchName) {
                          // 🚀 Google 官方推薦的「關鍵字搜尋導航公式」
                          // 它會自動去對齊 Google Maps 上的實體商標與車道入口！
                          const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchName)}`;
                          
                          window.open(googleMapsUrl, '_blank');
                        } else {
                          alert("抱歉，此位置缺少關鍵字資料，無法導航！");
                        }
                      }}
                      className="w-full font-bold text-[11px] tracking-wide transition-all flex items-center gap-0 mb-2.5 active:scale-95"
                      style={{ 
                        backgroundColor: '#ffffff',
                        color: '#4F46E5', 
                        border: 'none', 
                        borderRadius: '8px',
                        cursor: 'pointer',
                        boxShadow: null
                      }}
                    >
                      {/* 🗺️ 線性指南針導航小 Icon */}
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="3 11 22 2 13 21 11 13 3 11" />
                      </svg>
                      使用 Google 地圖導航
                    </button>

                    {/* ⏱️ 3. 營運時間（極簡線性時鐘） */}
                    <p className="text-xs m-0 mb-2.5 flex items-center gap-1.5" style={{ color: '#6b7280' }}>
                      <svg className="w-[1.1em] h-[1.1em] flex-shrink-0" style={{ color: '#9ca3af', marginBottom: '0.02em', marginRight: '4px'}} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      <span>{item.service_time || '未提供資料'}</span>
                    </p>

                    {/* 📊 區塊分隔線與剩餘車位列表 */}
                  <div style={{ borderTop: '1px solid #f1f5f9', marginTop: '8px', marginBottom: '10px', width: '100%' }} />
                  <div className="flex flex-col gap-2">
                    
                    {/* 🚗 一般車位 */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500 flex items-center gap-1.5">
                        {/* 線性小汽車 Icon */}
                        <svg className="w-[1.2em] h-[1.2em] flex-shrink-0" style={{ color: '#9ca3af', marginRight: '2px'}} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
                          <circle cx="7" cy="17" r="2" /><path d="M9 17h6" /><circle cx="17" cy="17" r="2" />
                        </svg>
                        一般剩餘
                      </span>
                      <span className="font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded text-[11px]">
                        {item.ava_car ?? '0'} <span className="text-[11px] text-blue-400 font-normal" >/ {item.car_space ?? 0}</span>
                      </span>
                    </div>

                    {/* ♿ 身障車位 */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500 flex items-center gap-1.5">
                        {/* 線性無障礙 Icon */}
                        <svg className="w-[1.2em] h-[1.2em] flex-shrink-0" style={{ color: '#9ca3af', marginRight: '2px'}} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="4" r="1.5" />
                          <path d="M9 8h4.5l1.5 5h3.5" />
                          <path d="M16 16.5A4.5 4.5 0 1 1 11.5 12" />
                        </svg>
                        身障剩餘
                      </span>
                      <span className="font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded text-[11px]">
                        {item.ava_handicap ?? '0'} <span className="text-[11px] text-blue-400 font-normal">/ {item.handicap_space ?? 0}</span>
                      </span>
                    </div>

                    {/* 🤰 孕婦車位 */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-600 flex items-center gap-1">
                        
                        {/* 🚀 關鍵改動：換上極簡流線心形（母子意象） */}
                        <svg 
                          className="w-[1.2em] h-[1.2em] flex-shrink-0" 
                          style={{ color: '#9ca3af', marginBottom: '-0.3em', marginRight: '2px'}} // 莫蘭迪灰维持一致
                          xmlns="http://www.w3.org/2000/svg" 
                          viewBox="0 0 24 24" 
                          fill="none" 
                          stroke="currentColor" 
                          strokeWidth="2.5" 
                          strokeLinecap="round" 
                          strokeLinejoin="round"
                        >
                          {/* 🚀 這個公式畫出一個大心形包著一個小心形，象徵母嬰流線，變小也絕對清晰 */}
                          <path d="M21 8a6 6 0 0 1-12 0 6 6 0 0 1 12 0Z" />
                          <path d="M12.5 12.5a3 3 0 0 1-6 0 3 3 0 0 1 6 0Z" />
                        </svg>
                        孕婦剩餘
                      </span>
                      <span className="font-bold text-pink-500 bg-pink-50 px-1.5 py-0.5 rounded text-[11px]">
                        {item.ava_pregnancy ?? '0'} <span className="text-[11px] text-gray-400 font-normal">/ {item.pregnancy_space ?? 0}</span>
                      </span>
                    </div>

                  </div>

                    {/* 🔗 4. 查看詳細收費按鈕（完美整合你的 onClick 防禦邏輯 + iOS 微感灰） */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation(); 
                        console.log("按鈕有被點到！目前的資料是：", item); 
                        setActiveFeeItem(item);
                      }}
                      className="w-full font-bold text-xs tracking-wide transition-colors block text-center mt-3"
                      style={{ 
                        backgroundColor: '#e5e7eb', // 🚀 套用跟你大彈窗一模一樣的 iOS 微感灰
                        color: '#4b5563', 
                        border: 'none', 
                        padding: '1px 0', 
                        borderRadius: '8px',       // 配合小彈窗比例，圓角 8px 最精緻
                        cursor: 'pointer'
                      }}
                    >
                      查看詳細收費標準
                    </button>
                  </div>
                </Popup>
              </Marker>
            );
          }
                
          // 🔵 情境 B：路邊停車格 (road)
          if (item.type === 'road' && item.geometry_wkt) {
            const coords = parseWKTToLatLng(item.geometry_wkt);
            if (!coords || coords.length < 2) return null; 
            
            const lineColor = getAvailabilityColor(item.ava_car);
            const textOpacity = getAvailabilityTextOpacity(item.ava_car);
            
            return (
              <FeatureGroup key={`road-secure-id-${item.road_id || item.id}`}>
                
                {/* 🛡️ 第一層：隱形觸控盾牌（寬度 25px，專門負責滑鼠靈敏點擊） */}
                <Polyline
                  positions={coords}
                  color="transparent"       
                  weight={30}               
                  opacity={0}               
                  lineCap="round"
                  lineJoin="round"
                  noClip={true}
                >
                  <Popup
                    maxWidth={220}
                    minWidth={220}
                    autoPanPadding={[50, 50]}
                  >
                    <div className="p-1 text-slate-800 font-sans">
                      <h3 className="text-sm font-bold m-0 mb-1 text-slate-900">路邊停車路段</h3>
                        <p className="text-xs m-0 mb-1.5 flex items-center gap-1.5" style={{ color: '#6b7280' }}>
                          <svg className="w-[1.1em] h-[1.1em] flex-shrink-0" style={{ color: '#9ca3af', marginBottom: '-0.02em', marginRight: '2px'}} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                            <circle cx="12" cy="10" r="3" />
                          </svg>
                          <span className="block truncat" title={item.road_name}>
                            {item.road_name || '暫無路名資料'}
                          </span>
                        </p> 
                        <div className="flex flex-col gap-1.5 pt-2.5 border-t border-slate-100">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-500 flex items-center gap-1.5">
                              {/* 線性小汽車 Icon */}
                              <svg className="w-[1.2em] h-[1.2em] flex-shrink-0" style={{ color: '#9ca3af', marginRight: '2px'}} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
                                <circle cx="7" cy="17" r="2" /><path d="M9 17h6" /><circle cx="17" cy="17" r="2" />
                              </svg>
                              一般剩餘
                            </span>
                            <span className="font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded text-[11px]">
                              {item.ava_car ?? '0'} <span className="text-[10px] text-blue-400 font-normal">/{item.total_car ?? 0}</span>
                            </span>
                          </div>
                          {/* ♿ 身障車位 */}
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gray-500 flex items-center gap-1.5">
                              {/* 線性無障礙 Icon */}
                              <svg className="w-[1.2em] h-[1.2em] flex-shrink-0" style={{ color: '#9ca3af', marginRight: '2px'}} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="4" r="1.5" />
                                <path d="M9 8h4.5l1.5 5h3.5" />
                                <path d="M16 16.5A4.5 4.5 0 1 1 11.5 12" />
                              </svg>
                              身障剩餘
                            </span>
                            <span className="font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded text-[11px]">
                              {item.ava_handicap ?? '0'} <span className="text-[10px] text-blue-400 font-normal">/{item.total_handicap ?? 0}</span>
                            </span>
                          </div>
                          {/* 🤰 孕婦車位 */}
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-gray-600 flex items-center gap-1">
                              
                              {/* 🚀 關鍵改動：換上極簡流線心形（母子意象） */}
                              <svg 
                                className="w-[1.2em] h-[1.2em] flex-shrink-0" 
                                style={{ color: '#9ca3af', marginBottom: '-0.3em', marginRight: '2px'}} // 莫蘭迪灰维持一致
                                xmlns="http://www.w3.org/2000/svg" 
                                viewBox="0 0 24 24" 
                                fill="none" 
                                stroke="currentColor" 
                                strokeWidth="2.5" 
                                strokeLinecap="round" 
                                strokeLinejoin="round"
                              >
                                {/* 🚀 這個公式畫出一個大心形包著一個小心形，象徵母嬰流線，變小也絕對清晰 */}
                                <path d="M21 8a6 6 0 0 1-12 0 6 6 0 0 1 12 0Z" />
                                <path d="M12.5 12.5a3 3 0 0 1-6 0 3 3 0 0 1 6 0Z" />
                              </svg>
                              孕婦剩餘：
                            </span>
                            <span className="font-bold text-pink-500 bg-pink-50 px-1.5 py-0.5 rounded text-xs">
                              {item.ava_pregnancy ?? '0'} <span className="text-gray-400 font-normal">/{item.total_pregnancy ?? 0}</span>
                            </span>
                          </div>
                        </div>
                    </div>
                    {/* 🔗 4. 查看詳細收費按鈕（完美整合你的 onClick 防禦邏輯 + iOS 微感灰） */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation(); 
                        console.log("按鈕有被點到！目前的資料是：", item); 
                        setActiveFeeItem(item);
                      }}
                      className="w-full font-bold text-xs tracking-wide transition-colors block text-center mt-3"
                      style={{ 
                        width: '200px',
                        backgroundColor: '#e5e7eb', // 🚀 套用跟你大彈窗一模一樣的 iOS 微感灰
                        color: '#4b5563', 
                        border: 'none', 
                        padding: '1px 0', 
                        borderRadius: '8px',       // 配合小彈窗比例，圓角 8px 最精緻
                        cursor: 'pointer'
                      }}
                    >
                      查看詳細收費標準
                    </button>
                  </Popup>
                </Polyline>

                <Polyline 
                  positions={coords} 
                  color={lineColor}
                  weight={2}                
                  opacity={textOpacity} 
                  lineCap="round" 
                  lineJoin="round" 
                  interactive={false}       
                  noClip={true}
                />

              </FeatureGroup>
            );
          }

          // 🟡 情境 C：黃線管制 (yellow_line) - 物理通水管版
          if (item.type === 'yellow_line' && item.geometry_wkt) {
            console.log(`📡 [黃線原始數據] ID: ${item.yl_id}, WKT:`, item.geometry_wkt);
            const coords = parseWKTToLatLng(item.geometry_wkt);
            console.log(`🎯 [黃線解析座標] ID: ${item.yl_id}, Coords 筆數: ${coords ? coords.length : 0}, 內容:`, coords);
            if (!coords || coords.length === 0) return null; // 隄防解析失敗

            return (
              <FeatureGroup key={`yl-secure-group-${item.yl_id || item.id}`}>
                {/* 🛡️ 第一層：隱形觸控盾牌（寬度 25px，直接用大寫 Prop 控制，完全透明負責抓點擊） */}
                <Polyline
                  positions={coords}
                  color="#C9A227"
                  weight={25}
                  opacity={0}
                >
                  <Popup>
                    <div className="p-1 text-slate-800 font-sans min-w-[200px]">
                      <h3 className="text-sm font-bold text-orange-700 m-0 mb-1 flex items-center gap-1">
                        ⚠️ 黃線管制路段
                      </h3>
                      <p className="text-xs m-0 text-slate-900 font-semibold mb-1">
                        🛣️ 路名：{item.road_name || '無特定路名'}
                      </p>
                      <p className="text-xs m-0 text-gray-500 mb-2">
                        🏙️ 行政區：{item.area_name || '未標示'}
                      </p>
                      
                      <div className="pt-1.5 border-t border-slate-100 text-xs">
                        <span className="text-gray-500 font-medium">🚫 管制禁停時間：</span>
                        <p className="m-0 mt-1 text-red-600 font-bold bg-red-50 px-1.5 py-1 rounded">
                          {item.control_time || '無資料'}
                        </p>
                      </div>
                    </div>
                  </Popup>
                </Polyline>

                {/* 🎨 第二層：視覺實線（寬度 3px 稍微加粗更顯眼，滑鼠穿透） */}
                <Polyline
                  positions={coords}
                  color="#F1C40F"
                  weight={3.5}
                  opacity={0.8}
                  lineCap="round"
                  lineJoin="round"
                  interactive={false} 
                  noClip={true}
                />
              </FeatureGroup>
            );
          }
          return null;
        })}
      </MapContainer>
      {activeFeeItem && createPortal(
        <div 
          className="fixed inset-0"
          style={{ 
            zIndex: 9999999,
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(15, 23, 42, 0.25)', // 🌑 這裡直接灌黑色半透明底
            backdropFilter: 'blur(2px)'
          }}
          // 🚀 點擊黑色背景，百分之百直接觸發關閉！
          onClick={() => setActiveFeeItem(null)} 
        >
          {/* ⬜ 視窗主體：鎖死寬度、絕對置中、物理防禦 */}
          <div 
            className="font-sans shadow-[0_25px_60px_rgba(0,0,0,0.3)]"
            style={{ 
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)', 
              width: '432px',
              minWidth: '320px',
              backgroundColor: '#F9FAFB', // 100% 實心白底
              borderRadius: '16px',
              border: '1px solid #e5e7eb',
              color: '#000000',
              padding: '0px 24px 24px 24px',
              boxSizing: 'border-box',
              cursor: 'default'
            }}
            // 🚀 點擊白色視窗內部時，阻斷它，不要觸發外層的關閉
            onClick={(e) => e.stopPropagation()} 
          >
            
            {/* 1. 標頭區 */}
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="text-base font-bold m-0 mb-1 flex items-center gap-2" style={{ color: '#111827' }}>
                  {/* 🅿️ 這是全新的純線性高質感 🅿️ Icon */}
                  <svg 
                    className="w-[1em] h-[1em] flex-shrink-0 inline-block align-text-bottom" // 🚀 1. 鎖定文字比例，並設定行內對齊
                    style={{ color: '#4F46E5' }} // 🚀 2. 微調下邊距，確保它跟中文字的水平線完美貼齊
                    xmlns="http://www.w3.org/2000/svg" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2.8" // 🚀 3. 縮小到跟字一樣大時，線條要加粗到 2.8 左右，看起來才不會太虛
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    {/* 內部的畫畫公式 */}
                    <rect x="2" y="2" width="20" height="20" rx="4" /> 
                    <path d="M9 17V7h4a3 3 0 0 1 0 6H9" />
                  </svg>

                  {/* 停車場或路段名稱 */}
                  <span>{activeFeeItem.lot_name || activeFeeItem.road_name || '未命名場站'}</span>
                </h3>
                {activeFeeItem.addr && (
                  <p 
                    className="text-xs m-0 mb-1 flex items-center gap-2.5" 
                    style={{ color: '#4B5563', paddingLeft: '0px' }} // 🚀 微調左邊距，讓它跟上面的標題完美對齊
                  >
                    {/* 🔲 這是全新的地址專用：微型線性圓角方框 📍 Icon */}
                    <svg 
                      className="w-[1.1em] h-[1.1em] flex-shrink-0 inline-block align-text-bottom" 
                      style={{ color: '#4B5563', marginBottom: '0px' }} // 質感低調灰
                      xmlns="http://www.w3.org/2000/svg" 
                      viewBox="0 0 24 24" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="2.2" // 🚀 降低一點線條粗細，變小也絕對不糊、超精細
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    >
                      {/* 🚀 關鍵改動：拿掉死板的外框！改用單純、優雅的經典線性大頭針幾何線條 */}
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>

                    {/* 真正的地址文字 */}
                    <span>{activeFeeItem.addr}</span>
                  </p>
                )}
              </div>
              <button 
                onClick={() => setActiveFeeItem(null)}
                className="text-gray-400 hover:text-gray-600 cursor-pointer text-lg font-light p-1 leading-none"
                style={{ 
                  marginTop: '20px',     // 歸零原本的微調，讓瀏覽器自動計算
                  padding: '4px',       // 稍微加大點擊判定區，讓滑鼠更好點
                  display: 'flex',
                  borderRadius: '8px',
                  border: '0.1px solid #c9c9c9'
                }}
              >
                ✕
              </button>
            </div>

            {/* 2. 營運時間 */}
            <p className="text-xs m-0 mb-2 flex items-center gap-2" style={{ color: '#4b5563' }}>
              {/* 🕒 全新極簡線性時鐘 Icon */}
              <svg 
                className="w-[1.1em] h-[1.1em] flex-shrink-0 inline-block align-text-bottom" 
                style={{ color: '#4B5563', marginBottom: '20px' }} 
                xmlns="http://www.w3.org/2000/svg" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2.2" 
                strokeLinecap="round" 
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" /> {/* 🚀 這行畫出時針與分針 */}
              </svg>

              {/* 營業時間文字 */}
              <span style={{ color: '#4B5563', marginBottom: '20px' }} >營運時間：{activeFeeItem.tw_open_info || '24 小時營業'}</span>
            </p>
            
            {/* 3. 核心內容區 */}
            <div className="flex flex-col gap-3 pt-3 border-t border-slate-100" style={{ borderTop: '1px solid #e5e7eb' }}>
              <div className="flex flex-col gap-1.5 text-sm">
                <div className="text-xs font-bold mb-1 flex items-center gap-1.5" style={{ color: '#1f2937' }}>
                  {/* 🪙 全新極簡線性錢幣 Icon */}
                  <svg 
                    className="w-[1.1em] h-[1.1em] flex-shrink-0 inline-block align-text-bottom" 
                    style={{ color: '#4B5563', marginBottom: '20px' }} // 低調灰色維持一致
                    xmlns="http://www.w3.org/2000/svg" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2.2" // 輕量化精細線條
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    {/* 🚀 關鍵改動：拿掉死板的字體符號，改用優雅的「雙層層疊硬幣」幾何線條 */}
                    {/* 後方硬幣的邊緣弧線 */}
                    <path d="M17 12A5 5 0 0 1 12 17M17 12a5 5 0 0 0-5-5" /> 
                    
                    {/* 前方主體硬幣 */}
                    <circle cx="9" cy="12" r="5" />
                    
                    {/* 硬幣中央高質感的極簡十字，隱喻錢幣刻紋，變小也極度清晰 */}
                    <path d="M9 10v4M7 12h4" />
                  </svg>
                  {/* 收費標準標題文字 */}
                  <span style={{ color: '#4B5563', marginBottom: '20px' }}>收費標準</span>
                </div>                
                {/* 核心費率文字框 */}
                <div 
                  className="font-bold rounded text-xs leading-relaxed whitespace-pre-wrap"
                  style={{ backgroundColor: '#f3f4f6', color: '#4b5569', border: '1px solid #eceff3', padding: '10px', borderRadius: '8px' }}
                >
                  {activeFeeItem.charge_fee || activeFeeItem.charge || '每小時 40 元。當日最高收費 200 元。'}
                </div>
              </div>

              {/* 更新時間小字 */}
              <div className="text-[10px] pt-1 flex items-center justify-between" style={{ color: '#6b7280', fontSize: '11px', marginBottom: '8px' }}>
                {/* 🚀 讓 Icon 和文字用 flex 水平置中，並用 gap-1 控制它們的橫向間距 */}
                <span className="flex items-center gap-2">
                  
                  {/* 全新高質感微型線性 ⓘ Icon */}
                  <svg 
                    className="w-[1.2em] h-[1.2em] flex-shrink-0" 
                    style={{ 
                      color: '#6b7280', 
                      // 🎯 垂直位置微調彈簧：
                      // 如果覺得 Icon 太高就調小（如 0em 或 -0.01em）
                      // 如果覺得 Icon 太低就調大（如 0.05em 或 0.08em）
                      marginBottom: '0.02em' 
                    }} 
                    xmlns="http://www.w3.org/2000/svg" 
                    viewBox="0 0 24 24" 
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2.5" // 線條粗細
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>

                  {/* 提示文字本體 */}
                  實際費率請以現場公告為準
                </span>
              </div>
            </div>

            {/* 4. 底部大按鈕 */}
            <div className="mt-4">
              <button
                onClick={() => setActiveFeeItem(null)}
                className="w-full text-white text-xs font-bold py-2 px-4 rounded shadow text-center cursor-pointer"
                style={{ backgroundColor: '#e5e7eb', color: '#4b5563', border: 'none', borderRadius: '12px', padding: '2px' }}
              >
                確認並關閉
              </button>
            </div>

          </div>
        </div>,
        document.body // 🚀 降維打擊：強行拔出地圖，直接塞進 HTML 最外層的 body！
      )}
    </div>
  );
}
const createOptimizedParkingIcon = (avaCar, currentRateItem) => {
  const isFull = avaCar <= 0 || avaCar === null || avaCar === undefined || avaCar === '';
  
  const bgColor = isFull ? '#9CA3AF' : '#3730A3'; 
  const wdColor = isFull ? '#F3F4F6' : '#F8FAFC';
  let rateText = '-';
  if (currentRateItem) {
    if (currentRateItem.hourly_rate !== null && currentRateItem.hourly_rate !== undefined) {
      rateText = `$${currentRateItem.hourly_rate}`;
    } else if (currentRateItem.per_time_rate !== null && currentRateItem.per_time_rate !== undefined) {
      rateText = `$${currentRateItem.per_time_rate}`;
    }
  }
  const spaceText = isFull ? '滿' : avaCar;

  return L.divIcon({
    className: 'my-premium-p-icon', 
    html: `
      <div style="
        display: flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        background-color: ${bgColor} !important;
        border: 1px solid #FFFFFF30 !important; 
        border-radius: 50% 50% 50% 10%; transform: rotate(-45deg);
        box-shadow: 0 2px 6px rgba(15,23,42,0.12); 
        cursor: pointer;
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      ">
        <div style="
          transform: rotate(45deg);
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          align-items: center;
          justify-content: center;
        ">
          <div style="
            font-family: sans-serif !important;
            font-weight: 700 !important;
            font-size: 11px !important;
            color: ${wdColor} !important;
            line-height: 1.2 !important;
            margin-top: 2px;
          ">
           ${spaceText}
          </div>
          <div style="
            width: 70%;
            border-top: 1px solid rgba(255, 255, 255, 0.4);
            margin: 2px 0;
          "></div>
          <div style="
            font-family: sans-serif !important;
            font-weight: 500 !important;
            font-size: 10px !important;
            color: ${isFull ? '#F3F4F6' : '#A5B4FC'} !important; /* 滿車顯示淡灰，有車位顯示科技亮藍 */
            line-height: 1.2 !important;
            margin-bottom: 2px;
          ">
            ${rateText}
          </div>
      </div>
    `,
    iconSize: [32, 32],   
    iconAnchor: [16, 16], 
    popupAnchor: [0, -16],
  });
};
export default App;
