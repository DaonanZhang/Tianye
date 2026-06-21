# Tianye React Frontend

`frontend/tianye` 现在是当前 demo 的唯一前端实现入口。

这里不再通过 `public/legacy/` 桥接旧脚本，路线预览、定位、GPX 导入、徒步会话、本地路径和景点图层都直接在 React 里实现。

## 运行方式

先启动 Django:

```bash
uv run python manage.py runserver
```

再启动 React:

```bash
cd frontend/tianye
npm run dev
```

开发地址:

- `http://127.0.0.1:5173`

## 当前能力

- 点击地图选起终点，调用 `/api/route-preview/` 生成路线
- 读取 `/api/scenic-spots/` 渲染景点
- 读取 `/api/saved-paths/` 渲染本地已保存路径
- 通过 `/api/gpx-import/` 导入 GPX 并立即进入当前路线
- 浏览器定位、当前位置设起点、轨迹累积
- 通过 `/api/hike-sessions/start/` 和 `/api/hike-sessions/<id>/finish/` 记录徒步会话
- 读取 `/api/hike-sessions/` 展示最近记录

## 依赖分类

- `local-data`
  - `public/data/beijing-*.geojson`
  - `/api/saved-paths/`
  - `/api/scenic-spots/`
- `local-service`
  - `/api/route-preview/`
  - `/api/elevation/`
  - `/api/gpx-import/`
  - `/api/hike-sessions/...`
- `external-api`
  - OpenStreetMap raster tiles
  - 仅作为临时可视化底图；即使瓦片不可用，本地 GeoJSON 与路线图层仍会继续显示

## 目录

- `src/App.jsx`: 主地图工作台
- `src/lib/api.js`: API 与 CSRF
- `src/lib/format.js`: 展示格式化
- `src/lib/geo.js`: 距离与路径几何辅助
