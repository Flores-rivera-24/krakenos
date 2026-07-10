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
        a: 'For now KrakenOS takes images (snapshots) from the camera. Continuous live video in the browser is a feature planned for later.',
      },
    ],
  },
};
