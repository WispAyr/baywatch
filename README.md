# Zone Occupancy Counter

A service that counts objects within polygon-defined zones from camera frames. Inspired by ZoneMinder's zone system.

## Features

- Define zones as polygon coordinates
- Background subtraction for motion detection
- Blob detection with configurable area thresholds
- REST API for zone management and analysis
- WebSocket for real-time occupancy updates
- SQLite storage for zone configs and history

## API Endpoints

### Zones

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/zones` | Create zone with polygon coords |
| GET | `/zones` | List all zones |
| GET | `/zones/:id` | Get single zone |
| PATCH | `/zones/:id` | Update zone |
| DELETE | `/zones/:id` | Delete zone |
| GET | `/zones/:id/count` | Get current occupancy |
| GET | `/zones/:id/history` | Get occupancy history |

### Analysis

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/analyze` | Submit frame for analysis |
| POST | `/analyze-stream` | Fetch from URL and analyze |
| POST | `/background` | Set/update background frame |
| GET | `/occupancy` | Get all zone occupancy counts |

### WebSocket

Connect to `ws://localhost:3620` for real-time updates.

Events:
- `initial_state` - Sent on connect with current zone states
- `occupancy_update` - Sent when zone occupancy changes
- `zone_created` / `zone_updated` / `zone_deleted`

## Usage Examples

### Create a zone

```bash
curl -X POST http://localhost:3620/zones \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Parking Bay A",
    "camera_id": "kyle-rise-front",
    "polygon": [
      {"x": 100, "y": 100},
      {"x": 400, "y": 100},
      {"x": 400, "y": 300},
      {"x": 100, "y": 300}
    ],
    "min_blob_area": 1000,
    "max_blob_area": 50000,
    "alarm_threshold": 5
  }'
```

### Analyze frame from go2rtc

```bash
curl -X POST http://localhost:3620/analyze-stream \
  -H "Content-Type: application/json" \
  -d '{
    "stream_url": "http://localhost:1984/api/frame.jpeg?src=kyle-rise-front",
    "camera_id": "kyle-rise-front"
  }'
```

### Set background frame

```bash
curl -X POST "http://localhost:3620/background?camera_id=kyle-rise-front" \
  -H "Content-Type: image/jpeg" \
  --data-binary @background.jpg
```

### Analyze frame (base64)

```bash
curl -X POST http://localhost:3620/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "image": "<base64-encoded-image>",
    "camera_id": "kyle-rise-front"
  }'
```

## Configuration

Zone parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `min_blob_area` | 500 | Minimum blob size (pixels²) |
| `max_blob_area` | 50000 | Maximum blob size (pixels²) |
| `alarm_threshold` | 1 | Count threshold for alarm |

## Port

Default: **3620**

Set with `PORT` environment variable.
