# LabTouch1: the lab touchscreen

LabTouch1 is a Raspberry Pi with a 7" 800×480 touchscreen in the lab. It runs Chromium in kiosk mode (cage, autologin on tty1) and shows one page: this console's `lab-touch` layout, served by rackmain1.

```
http://rackmain1:3098/console/index.html?layout=lab-touch
```

Set that URL in `/etc/labtouch/kiosk.env` (`KIOSK_URL=...`) on LabTouch1 and run `sudo systemctl restart getty@tty1`.

## Pages

| Page | Panels | Feeds |
| --- | --- | --- |
| HOME | Clock, date, outdoor temperature; tiles for printers, machines, network (tap to open the page) | `/printers-data`, `/node-status-data`, `/lab-node-data`, `/api/weather` |
| PRINTERS | Every printer and the laser; tap for one device at a time | `/printers-data/current.json` (AP3X-PRINTERS-1) |
| CAMERAS | Lab Cam (Wyze, large) plus X1C, H2C, P2S, R1; still frames every 3 s; tap a camera, then WATCH LIVE | rackmain1's go2rtc: `/go2rtc/api/frame.jpeg?src=lab_*`, `/go2rtc/stream.html?src=lab_*` |
| CLIMATE | Outside conditions and 7-day forecast; lab temperature, HVAC, and lights reserved | `/api/weather`, `/local-ops-data/current.geojson` (map center for the NWS forecast) |
| NETWORK | LabPi1 throughput (10 minutes), interfaces, health, and every machine | `/lab-node-data/current.json` (AP3X-LAB-NODE-1), `/node-status-data` |

After two minutes without a touch the screen returns to HOME. A live video view closes itself after ten minutes.

## Nothing sensitive on the screen

LabTouch1 holds no credentials. It reads the same read-only, same-origin feeds as the walls. Printer access codes stay in LabPi1's go2rtc config; the console only loads frames and go2rtc's player page through rackmain1.

## Cameras

The printers' cameras are on the lab LAN, which rackmain1 can't reach directly:

1. go2rtc on LabPi1 reads each printer's camera (Bambu LAN live view) and serves RTSP on its Tailscale address only.
2. rackmain1's existing go2rtc adds one stream per camera from LabPi1, named `lab_cam`, `lab_x1c`, `lab_h2c`, `lab_p2s`, `lab_r1`.
3. The console asks rackmain1's go2rtc (already proxied at `/go2rtc/`) for frames and the live player.

Until step 2 exists the camera tiles say WAITING FOR A FRAME.

The lab's Wyze Cam v2 keeps its stock firmware: docker-wyze-bridge on LabPi1 signs in to the Wyze account (credentials in a mode-600 file on LabPi1), discovers every camera on it, and streams locally. A camera named **Lab Cam** in the Wyze app becomes the bridge stream `lab-cam`, LabPi1's go2rtc stream `lab_cam`, and rackmain1's `lab_cam`, so setting it up in the Wyze app is all it takes.

## Climate and lights

No lab sensors, HVAC, or lights are connected yet. The CLIMATE page shows outdoor conditions and marks the other three slots NOT LINKED, with what each needs. Once hardware is chosen (Home Assistant is the simplest single integration for all three), the lab-climate module gains a feed and real controls.
