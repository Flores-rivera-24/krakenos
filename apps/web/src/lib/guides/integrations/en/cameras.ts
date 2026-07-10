import type { IntegrationGuide } from '../../types';

/**
 * English version of the IP camera guide over RTSP (US-177). Same structure,
 * ids and technical fields as `../cameras.ts`; only the prose is translated.
 */

const rtsp: IntegrationGuide = {
  id: 'rtsp',
  domain: 'camera',
  kind: 'rtsp',
  category: 'cameras',
  displayName: 'IP camera (RTSP)',
  vendor: 'Generic (Hikvision, Dahua, Reolink, TP-Link Tapo...)',
  icon: 'Camera',
  tier: 3,
  intro:
    'Most network surveillance cameras (Hikvision, Dahua, Reolink, TP-Link and many more) stream their live video through a special address called RTSP. If you give KrakenOS that address, it can show you images from your camera without depending on the manufacturer\'s cloud. Everything stays in your home. You just need to find that RTSP address on your camera.',
  prerequisites: [
    'An IP camera connected to your network with RTSP enabled (almost all have it; sometimes you have to turn it on in their settings).',
    'The camera\'s RTSP address (it starts with rtsp://). It usually includes a username and password.',
    'Recommended: reserve a fixed IP for the camera on the router so the address does not change.',
  ],
  steps: [
    {
      title: 'Enable RTSP and create a user on the camera',
      body: 'Go into your camera\'s settings (through its app or its web page) and make sure RTSP is enabled. Many brands ask you to create a specific username and password for RTSP access; do it and write them down.',
      external: true,
    },
    {
      title: 'Find out the RTSP address',
      body: 'The RTSP address has this form: rtsp://user:password@camera-IP:554/path. The "554" is the usual port and the "path" at the end depends on the brand (sometimes it is /stream1, /h264, /Streaming/Channels/101...). You will find it in the camera\'s manual, in its app, or by searching for the model online.',
      command: 'rtsp://usuario:contraseña@192.168.1.20:554/stream1',
      note: 'Tip: reserve a fixed IP for the camera on the router so this address does not change over time.',
      external: true,
    },
    {
      title: 'Add the camera in KrakenOS',
      body: 'Give the camera a name, paste its RTSP address and, if you want, indicate which room it is in and the model. The RTSP address contains the password, so it is stored encrypted and never shown again. When you save, KrakenOS will be able to capture images from the camera.',
    },
  ],
  fields: [
    {
      key: 'name',
      label: 'Camera name',
      help: 'A name to recognize it, for example "Entrance" or "Garden".',
      type: 'text',
      placeholder: 'Entrance',
      required: true,
    },
    {
      key: 'rtspUrl',
      label: 'RTSP address',
      help: 'The address of the camera\'s video, starting with rtsp://. It usually includes a username and password, which is why it is stored encrypted and not shown again.',
      type: 'url',
      placeholder: 'rtsp://usuario:contraseña@192.168.1.20:554/stream1',
      required: true,
      secret: true,
    },
    {
      key: 'room',
      label: 'Room (optional)',
      help: 'Where the camera is, to organize it better. For example "Living room".',
      type: 'text',
      placeholder: 'Living room',
      required: false,
    },
    {
      key: 'model',
      label: 'Model (optional)',
      help: 'The camera model, for reference only.',
      type: 'text',
      placeholder: 'Reolink RLC-810A',
      required: false,
    },
    {
      key: 'transport',
      label: 'Transport',
      help: 'How the video travels. "TCP" is more stable and works in almost every case; "UDP" is faster but can fail. Leave it on TCP if you are not sure.',
      type: 'select',
      required: false,
      defaultValue: 'tcp',
      options: [
        { value: 'tcp', label: 'TCP (recommended)' },
        { value: 'udp', label: 'UDP' },
      ],
    },
  ],
  troubleshooting: [
    {
      q: 'The camera shows up but there is no image.',
      a: 'It is almost always an error in the RTSP address: check the username, the password, the IP and especially the "path" at the end (it varies a lot between brands). Also try switching the transport to TCP.',
    },
    {
      q: 'I do not know what my RTSP address is.',
      a: 'Search for it by your camera\'s exact model: almost every brand publishes the format of its RTSP address. It is also usually in the manual or in the camera\'s advanced settings.',
    },
    {
      q: 'Can I watch continuous live video?',
      a: 'For now KrakenOS takes still images (snapshots) from the camera. Continuous live video in the browser is a feature planned for later.',
    },
  ],
};

export const CAMERA_GUIDES_EN: IntegrationGuide[] = [rtsp];
