import type { GuideTranslations } from '../localize';

/**
 * Traducción al inglés de las guías de cámaras (US-177). Superpone solo el texto
 * visible sobre la fuente en español (`integrations/cameras.ts`); la estructura la
 * toma el original.
 */
export const CAMERA_GUIDES_EN: GuideTranslations = {
  rtsp: {
    displayName: 'IP camera (RTSP)',
    vendor: 'Generic (Hikvision, Dahua, Reolink, TP-Link Tapo…)',
    intro:
      'Most network surveillance cameras (Hikvision, Dahua, Reolink, TP-Link and many more) broadcast their live video through a special address called RTSP. If you give KrakenOS that address, it can show you images from your camera without relying on the manufacturer’s cloud. Everything stays in your home. You just need to find that RTSP address on your camera.',
    prerequisites: [
      'An IP camera connected to your network with RTSP enabled (almost all have it; sometimes you have to turn it on in its settings).',
      'The camera’s RTSP address (it starts with rtsp://). It usually includes a username and password.',
      'Recommended: reserve a fixed IP for the camera on the router so the address does not change.',
    ],
    steps: [
      {
        title: 'Enable RTSP and create a user on the camera',
        body: 'Open your camera’s settings (through its app or its web page) and make sure RTSP is enabled. Many brands ask you to create a specific username and password for RTSP access; do it and write them down.',
      },
      {
        title: 'Find out the RTSP address',
        body: 'The RTSP address looks like this: rtsp://user:password@camera-IP:554/path. The “554” is the usual port and the “path” at the end depends on the brand (sometimes it is /stream1, /h264, /Streaming/Channels/101…). You can find it in the camera’s manual, in its app, or by searching for the model online.',
        command: 'rtsp://user:password@192.168.1.20:554/stream1',
        note: 'Tip: reserve a fixed IP for the camera on the router so this address does not change over time.',
      },
      {
        title: 'Add the camera in KrakenOS',
        body: 'Give the camera a name, paste its RTSP address and, if you want, indicate which room it is in and the model. The RTSP address contains the password, so it is stored encrypted and never shown again. Once saved, KrakenOS will be able to capture images from the camera.',
      },
    ],
    fields: {
      name: {
        label: 'Camera name',
        help: 'A name to recognize it, for example “Entrance” or “Garden”.',
        placeholder: 'Entrance',
      },
      rtspUrl: {
        label: 'RTSP address',
        help: 'The address of the camera’s video, starting with rtsp://. It usually includes a username and password, which is why it is stored encrypted and not shown again.',
        placeholder: 'rtsp://user:password@192.168.1.20:554/stream1',
      },
      room: {
        label: 'Room (optional)',
        help: 'Where the camera is, to organize it better. For example “Living room”.',
        placeholder: 'Living room',
      },
      model: {
        label: 'Model (optional)',
        help: 'The camera model, for reference only.',
      },
      transport: {
        label: 'Transport',
        help: 'How the video travels. “TCP” is more stable and works in almost all cases; “UDP” is faster but can fail. Leave TCP if you are not sure.',
        options: {
          tcp: 'TCP (recommended)',
          udp: 'UDP',
        },
      },
    },
    troubleshooting: [
      {
        q: 'The camera appears but shows no image.',
        a: 'It is almost always an error in the RTSP address: check the username, password, IP and above all the “path” at the end (it varies a lot between brands). Also try changing the transport to TCP.',
      },
      {
        q: 'I don’t know my RTSP address.',
        a: 'Search for it by the exact model of your camera: almost all brands publish the format of their RTSP address. It is usually also in the manual or in the camera’s advanced settings.',
      },
      {
        q: 'Can I watch continuous live video?',
        a: 'Yes: on the Cameras page, the “Watch live” button opens the live video. The server needs ffmpeg installed; the video is only processed while someone is watching.',
      },
    ],
  },
  frigate: {
    displayName: 'Frigate (NVR with object detection)',
    vendor: 'Frigate (frigate.video)',
    intro:
      'Frigate is a free network video recorder (NVR) that detects objects with AI: it can tell a person from a car or a cat. If you already run it (or want “serious” cameras), KrakenOS connects to it and inherits that detection: its cameras show up here, alerts arrive with what was detected (“person at the entrance”) and Frigate’s recordings can be viewed from KrakenOS. It is the recommended path for real surveillance; KrakenOS’s own detector is more basic and remains for setups without Frigate.',
    prerequisites: [
      'A Frigate server running on your local network (frigate.video has the install guide).',
      'The Frigate address (for example http://192.168.1.30:5000).',
      'Your cameras already configured inside Frigate (KrakenOS lists them as-is).',
    ],
    steps: [
      {
        title: 'Find your Frigate address',
        body: 'It is the same address you use to open the Frigate interface in the browser, usually on port 5000. KrakenOS will talk to it only inside your network; that address is never shared with the browser and never leaves your home.',
      },
      {
        title: 'Connect it in KrakenOS',
        body: 'Paste the address and save. Frigate’s cameras will appear on the Cameras page; live video and recordings are served through KrakenOS, authenticated like everything else.',
      },
      {
        title: 'Enable alerts per camera',
        body: 'Open each camera’s motion settings and enable them. With Frigate, alerts include the detected object, and automations can filter by it: “if a person is detected at the Entrance → turn on the light”.',
      },
    ],
    fields: {
      url: {
        label: 'Frigate address',
        help: 'The URL of your Frigate server on the local network, usually on port 5000.',
        placeholder: 'http://192.168.1.30:5000',
      },
      go2rtcUrl: {
        label: 'Live video address (optional)',
        help: 'Only if you changed the port of the go2rtc bundled with Frigate. Empty = same server on port 1984.',
        placeholder: 'http://192.168.1.30:1984',
      },
    },
    troubleshooting: [
      {
        q: 'Cameras do not appear.',
        a: 'Check that the Frigate address opens its interface from another device on the network and that the cameras are configured inside Frigate. KrakenOS lists exactly the ones Frigate knows.',
      },
      {
        q: 'Alerts do not say what was detected.',
        a: 'The detected object (person, car…) comes from Frigate. Check that object detection is enabled in Frigate’s configuration for that camera.',
      },
      {
        q: 'What about KrakenOS’s own motion detection?',
        a: 'With Frigate connected it turns itself off: detection lives in Frigate (which does it better) and KrakenOS does not duplicate it. Per-camera alert settings (enabled, arming schedule, time between alerts) still apply.',
      },
      {
        q: 'Can I delete recordings from KrakenOS?',
        a: 'No: recordings live in Frigate and their retention is configured there. KrakenOS lists and downloads them — honest, without duplicating the management.',
      },
    ],
  },
};
