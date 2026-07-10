import type { IntegrationGuide } from '../../types';

/**
 * English versions of the network guides (US-177). Same structure, ids and
 * technical fields as `../network.ts`; only the prose is translated.
 */

const wireguard: IntegrationGuide = {
  id: 'wireguard',
  domain: 'vpn',
  kind: 'wireguard',
  category: 'remote-access',
  displayName: 'Remote access (WireGuard)',
  vendor: 'WireGuard',
  icon: 'ShieldCheck',
  tier: 1,
  intro:
    'This lets you reach your home securely from anywhere: check KrakenOS, view your cameras or control your lights from your phone no matter where you are, as if you were on the couch. It uses a VPN (a private, encrypted tunnel) built on WireGuard technology. The best part is you do not need to understand anything technical: KrakenOS generates the configuration and a QR code, and you just scan it with an app.',
  prerequisites: [
    'The free "WireGuard" app installed on your phone or laptop (it is in the app stores).',
    'A name to identify the device you are about to connect (for example "Ana\'s phone").',
  ],
  steps: [
    {
      title: 'Name the device',
      body: 'Type a name to recognize the device you want to connect to the VPN, for example "Ana\'s phone" or "Work laptop". That name is just for you, to tell each access apart. KrakenOS takes care of the rest: it builds the whole configuration under the hood.',
    },
    {
      title: 'Install the WireGuard app',
      body: 'On the phone or laptop you want to connect, install the free, official WireGuard app from the app store. It is the one that will open the secure tunnel to your home.',
      external: true,
    },
    {
      title: 'Scan the QR code',
      body: 'When you create the access, KrakenOS shows you a QR code. Open the WireGuard app, choose "Add tunnel → Scan from QR code" and point it at the screen. The configuration imports itself. Turn on the tunnel and you will be securely connected to your home.',
      note: 'The QR code contains a private key: do not share it or take a photo of it to send to anyone.',
      external: true,
    },
    {
      title: 'Check the connection',
      body: 'With the tunnel turned on in the WireGuard app, try opening KrakenOS or reaching a device at home. You should get there as if you were on your own network. To stop using the VPN, turn off the tunnel in the app.',
    },
  ],
  fields: [
    {
      key: 'name',
      label: 'Device name',
      help: 'A name to recognize this access, for example "Ana\'s phone". It only helps you tell each connected device apart.',
      type: 'text',
      placeholder: 'Ana\'s phone',
      required: true,
    },
  ],
  troubleshooting: [
    {
      q: 'I scan the QR code but I cannot connect.',
      a: 'Make sure you have turned on the tunnel in the WireGuard app (a switch). Also check that your home is reachable from outside; if your internet connection changes its address often, you may need a dynamic name (DDNS).',
    },
    {
      q: 'Is it safe? Am I opening my home to the internet?',
      a: 'It is about as safe as it gets. Only someone with a configuration you generated (the QR code) can come in through the tunnel. No screen or device is exposed directly to the internet.',
    },
    {
      q: 'I want to connect one more device.',
      a: 'Create a new access with a different name. Each device (each phone, each laptop) has its own configuration and its own QR code.',
    },
  ],
};

const pihole: IntegrationGuide = {
  id: 'pihole',
  domain: 'dns',
  kind: 'pihole',
  category: 'ad-blocking',
  displayName: 'Ad blocking (Pi-hole)',
  vendor: 'Pi-hole',
  icon: 'ShieldBan',
  tier: 2,
  intro:
    'Pi-hole is a small server that blocks ads and trackers for your WHOLE home at once, without installing anything on each device. It works through DNS (the "contact book" of the internet): when a device tries to load an ad, Pi-hole simply replies that the site does not exist. If you already have a Pi-hole running, KrakenOS can connect to it to show you statistics and manage it.',
  prerequisites: [
    'A Pi-hole already installed and running on your network (for example on a Raspberry Pi or on your server).',
    'The web address of the Pi-hole dashboard.',
    'The password for the Pi-hole dashboard, if it has one (it is optional).',
  ],
  steps: [
    {
      title: 'Find your Pi-hole address',
      body: 'You need the web address of the Pi-hole admin dashboard, which is usually something like http://192.168.1.5/admin. It is the same one you open in the browser to see its statistics.',
      external: true,
    },
    {
      title: 'Have the password ready (if it has one)',
      body: 'Pi-hole may ask for a password to enter its dashboard. If yours has one, keep it handy for the next step. If your Pi-hole does not ask for a password, you can leave that field empty.',
      external: true,
    },
    {
      title: 'Connect KrakenOS',
      body: 'Enter your Pi-hole address and, if needed, its password. When you save, KrakenOS connects and you will be able to see how many requests are being blocked and manage the filtering from here.',
    },
  ],
  fields: [
    {
      key: 'baseUrl',
      label: 'Pi-hole address',
      help: 'The web address of the Pi-hole dashboard, for example http://192.168.1.5/admin.',
      type: 'url',
      placeholder: 'http://192.168.1.5/admin',
      required: true,
    },
    {
      key: 'password',
      label: 'Password (optional)',
      help: 'The password for the Pi-hole dashboard, if it has one. Leave it empty if your Pi-hole does not ask for a password. It is stored encrypted.',
      type: 'password',
      required: false,
      secret: true,
    },
  ],
  troubleshooting: [
    {
      q: 'It will not connect to Pi-hole.',
      a: 'Check that the address is correct (including the /admin part if it applies) and that the Pi-hole is powered on and reachable from the KrakenOS server. If it has a password, make sure it is the right one.',
    },
    {
      q: 'It connects but does not block ads on my devices.',
      a: 'For Pi-hole to filter, your devices (or your router) must use it as their DNS server. That is set up in the router or on each device; KrakenOS shows you the status, but DNS is decided by your network.',
    },
  ],
};

const iptables: IntegrationGuide = {
  id: 'iptables',
  domain: 'firewall',
  kind: 'iptables',
  category: 'firewall',
  displayName: 'Firewall (rules)',
  icon: 'Flame',
  tier: 2,
  intro:
    'The firewall is the "doorkeeper" of your network: it decides which communications are allowed and which are blocked. With KrakenOS you can create simple rules to, for example, keep a device from talking to the internet, or shut the door on certain kinds of connections. There is nothing to "connect" here: it is a feature that is already included and is used from the Firewall screen.',
  prerequisites: [
    'A router or server managed by KrakenOS that applies the rules (it happens underneath, safely).',
    'A clear idea of what you want to allow or block (for example, "keep the camera off the internet").',
  ],
  steps: [
    {
      title: 'Understand a rule',
      body: 'A firewall rule says, at its core: "for this kind of traffic, allow it or block it". You can base it on the source device, the destination or the type of connection (the port and protocol). Order matters: rules are checked top to bottom and the first one that matches is applied.',
    },
    {
      title: 'Start simple',
      body: 'A very common and useful case is keeping a questionable device (a cheap camera, a smart toy) off the internet, leaving it only the local network. Another is blocking a device entirely. Create the rule from the Firewall screen and watch the effect.',
      note: 'Start with a single rule and check that it does what you expect before adding more. That way it is easy to know what each one does.',
    },
    {
      title: 'Review and adjust',
      body: 'After creating a rule, test that the affected device behaves the way you wanted (for example, that it no longer reaches the internet). If something stops working by accident, disable the rule and try again with a different approach.',
      warning: 'Be careful not to block your own access to KrakenOS or the internet. When in doubt, start with rules that affect a single device.',
    },
  ],
  fields: [],
  troubleshooting: [
    {
      q: 'I created a rule and now something does not work.',
      a: 'Disable or delete the last rule you added and check whether it fixes things. Rules are applied in order, so sometimes a new rule "covers" another one. Go one at a time.',
    },
    {
      q: 'What is a "port" and a "protocol"?',
      a: 'The port is like the door number of a service within an address (the web uses 443, for example). The protocol (TCP or UDP) is the language the data travels in. In simple rules you do not need to touch them.',
    },
  ],
};

const vlan: IntegrationGuide = {
  id: 'vlan',
  domain: 'vlan',
  kind: 'vlan',
  category: 'vlan',
  displayName: 'Separate networks (VLAN)',
  icon: 'Network',
  tier: 3,
  intro:
    'A VLAN lets you split your network into separate zones using the same router and the same wiring, like putting partitions inside your home. The most common use: having one zone for your computers and phones, and another separate one for smart devices (bulbs, cameras, plugs). That way, if one of those cheap devices had a security flaw, it could not see your personal devices.',
  prerequisites: [
    'Network equipment that supports VLAN (many routers and managed switches do).',
    'An idea of which zones you want to create (for example: "home" and "smart devices").',
  ],
  steps: [
    {
      title: 'Think in zones',
      body: 'Before creating anything, decide which zones you want. The most common are two: one for your trusted devices (computers, phones) and another for smart devices and guests. Each zone will be a VLAN with its own name.',
    },
    {
      title: 'Create the VLAN',
      body: 'From the VLAN screen, create a new zone with a clear name (for example "IoT"). Underneath, each VLAN carries an identifier number (a "tag"). You can decide whether the zone is isolated from the rest, which is exactly what you want for smart devices.',
      note: 'The tag is simply the number that identifies the VLAN within the network equipment. It does not need to mean anything special.',
    },
    {
      title: 'Assign devices and check',
      body: 'Place each device in its zone. From then on, devices in an isolated VLAN will have internet but will not see those in other VLANs. Check that everything that should work still works (for example, controlling your lights from your phone may require allowing that communication between zones).',
      warning: 'Fully isolating smart devices can keep apps on your phone from "discovering" them. If something stops appearing, you may need to allow a small bridge between zones.',
    },
  ],
  fields: [],
  troubleshooting: [
    {
      q: 'I put my lights in an isolated VLAN and now I cannot control them.',
      a: 'Full isolation also cuts the communication between your phone and the lights. You usually need to allow "discovery" (mDNS) or a specific rule between your phone\'s zone and the devices\' zone.',
    },
    {
      q: 'Do I really need a VLAN?',
      a: 'No. It is a recommended security improvement if you have many smart devices, but your network works perfectly fine without a VLAN. It is a more advanced step.',
    },
  ],
};

const qos: IntegrationGuide = {
  id: 'qos',
  domain: 'qos',
  kind: 'tc',
  category: 'qos',
  displayName: 'Internet priority (QoS)',
  icon: 'Gauge',
  tier: 2,
  intro:
    'QoS (Quality of Service) is for sharing your internet sensibly. Bandwidth is like the width of a pipe: if someone starts downloading something huge, it can starve a video call or the TV stream. With QoS you give priority to what matters or set a limit on what can hog the connection, so everyone browses smoothly.',
  prerequisites: [
    'A router or server managed by KrakenOS capable of applying traffic control.',
    'Knowing, roughly, what internet speed you have contracted (it helps share it well).',
  ],
  steps: [
    {
      title: 'Identify what you want to protect or limit',
      body: 'Think about which activities should never be cut off (video calls, online gaming, live TV) and which devices or uses tend to "eat up" the connection (large downloads, backups). QoS works by giving priority to the former or throttling the latter.',
    },
    {
      title: 'Create a priority or limit rule',
      body: 'From the QoS screen, create a rule: for example, give priority to video-call traffic, or cap the top speed of a specific device. Start with a clear rule and watch the result in everyday use.',
      note: 'If you know your contracted speed, enter it: QoS shares things better when it knows how much "pipe" there is in total.',
    },
    {
      title: 'Adjust based on experience',
      body: 'Try it for a few days. If you notice something important still gets cut off, raise its priority or lower the limit of the device that hogs. QoS is about fine-tuning bit by bit until the connection feels smooth for everyone.',
    },
  ],
  fields: [],
  troubleshooting: [
    {
      q: 'I turned on QoS but I do not notice a difference.',
      a: 'QoS is only noticeable when the connection is saturated (several uses at once). If you have plenty to spare, you will not see changes. Also make sure you entered your contracted speed correctly.',
    },
    {
      q: 'Does QoS take away speed?',
      a: 'It does not reduce your total speed; it just shares it better when there is competition. A small margin may be reserved so prioritization works, but the goal is for everything to run smoother, not slower.',
    },
  ],
};

export const NETWORK_GUIDES_EN: IntegrationGuide[] = [wireguard, pihole, iptables, vlan, qos];
