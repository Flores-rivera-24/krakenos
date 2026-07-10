import type { GuideTranslations } from '../localize';

/**
 * Traducción al inglés de las guías de network (US-177). Superpone solo el texto
 * visible sobre la fuente en español (`integrations/network.ts`); la estructura la
 * toma el original.
 */
export const NETWORK_GUIDES_EN: GuideTranslations = {
  wireguard: {
    displayName: 'Remote access (WireGuard)',
    vendor: 'WireGuard',
    intro:
      'This lets you reach your home from anywhere, securely: check KrakenOS, view your cameras or control your lights from your phone wherever you are, as if you were in the living room. It uses a VPN (a private, encrypted tunnel) built on WireGuard technology. Best of all, you don’t need to understand anything technical: KrakenOS generates the configuration and a QR code, and you just scan it with an app.',
    prerequisites: [
      'The free “WireGuard” app installed on your phone or laptop (it’s in the app stores).',
      'A name to identify the device you’re going to connect (for example “Ana’s phone”).',
    ],
    steps: [
      {
        title: 'Name the device',
        body: 'Type a name to recognize the device you want to connect to the VPN, for example “Ana’s phone” or “Work laptop”. That name is just for you, to tell each access apart. KrakenOS handles the rest: it builds all the configuration under the hood.',
      },
      {
        title: 'Install the WireGuard app',
        body: 'On the phone or laptop you want to connect, install the official, free WireGuard app from the app store. It’s the one that will open the secure tunnel to your home.',
      },
      {
        title: 'Scan the QR code',
        body: 'When you create the access, KrakenOS shows you a QR code. Open the WireGuard app, choose “Add tunnel → Scan from QR code” and point it at the screen. The configuration imports itself. Turn on the tunnel and you’ll be connected to your home securely.',
        note: 'The QR code contains a private key: don’t share it or take a photo of it to send to anyone.',
      },
      {
        title: 'Check the connection',
        body: 'With the tunnel turned on in the WireGuard app, try opening KrakenOS or reaching a device at home. You should get through as if you were on your own network. To stop using the VPN, turn off the tunnel in the app.',
      },
    ],
    fields: {
      name: {
        label: 'Device name',
        help: 'A name to recognize this access, for example “Ana’s phone”. It only helps you tell each connected device apart.',
        placeholder: 'Ana’s phone',
      },
    },
    troubleshooting: [
      {
        q: 'I scan the QR but I can’t connect.',
        a: 'Make sure you’ve turned on the tunnel in the WireGuard app (a switch). Also check that your home is reachable from outside; if your internet connection changes address often, you may need a dynamic name (DDNS).',
      },
      {
        q: 'Is it safe? Am I opening my home to the internet?',
        a: 'It’s about as safe as it gets. Only someone with a configuration you generated (the QR) can get in through the tunnel. No screen or device is exposed directly to the internet.',
      },
      {
        q: 'I want to connect another device.',
        a: 'Create a new access with a different name. Each device (each phone, each laptop) has its own configuration and its own QR.',
      },
    ],
  },
  pihole: {
    displayName: 'Ad blocking (Pi-hole)',
    vendor: 'Pi-hole',
    intro:
      'Pi-hole is a small server that blocks ads and trackers for your WHOLE home at once, without installing anything on each device. It works through DNS (the internet’s “contacts list”): when a device tries to load an ad, Pi-hole simply replies that the site doesn’t exist. If you already have a Pi-hole running, KrakenOS can connect to it to show you statistics and manage it.',
    prerequisites: [
      'A Pi-hole already installed and running on your network (for example on a Raspberry Pi or on your server).',
      'The web address of the Pi-hole dashboard.',
      'The Pi-hole dashboard password, if it has one (it’s optional).',
    ],
    steps: [
      {
        title: 'Find your Pi-hole’s address',
        body: 'You need the web address of the Pi-hole admin dashboard, which is usually something like http://192.168.1.5/admin. It’s the same one you open in the browser to see its statistics.',
      },
      {
        title: 'Have the password ready (if it has one)',
        body: 'Pi-hole may ask for a password to enter its dashboard. If yours has one, have it ready for the next step. If your Pi-hole doesn’t ask for a password, you can leave that field empty.',
      },
      {
        title: 'Connect KrakenOS',
        body: 'Enter your Pi-hole’s address and, if needed, its password. When you save, KrakenOS connects and you’ll be able to see how many requests are being blocked and manage filtering from here.',
      },
    ],
    fields: {
      baseUrl: {
        label: 'Pi-hole address',
        help: 'The web address of the Pi-hole dashboard, for example http://192.168.1.5/admin.',
        placeholder: 'http://192.168.1.5/admin',
      },
      password: {
        label: 'Password (optional)',
        help: 'The Pi-hole dashboard password, if it has one. Leave it empty if your Pi-hole doesn’t ask for a password. It’s stored encrypted.',
      },
    },
    troubleshooting: [
      {
        q: 'It won’t connect to Pi-hole.',
        a: 'Check that the address is correct (including the /admin part if it applies) and that the Pi-hole is on and reachable from the KrakenOS server. If it has a password, make sure it’s the right one.',
      },
      {
        q: 'It connects but doesn’t block ads on my devices.',
        a: 'For Pi-hole to filter, your devices (or your router) must use it as their DNS server. That’s set up on the router or on each device; KrakenOS shows you the status, but your network decides the DNS.',
      },
    ],
  },
  iptables: {
    displayName: 'Firewall (rules)',
    intro:
      'The firewall is your network’s “doorman”: it decides which communications are allowed and which are blocked. With KrakenOS you can create simple rules to, for example, stop a device from talking to the internet, or close off certain kinds of connections. There’s nothing to “connect” here: it’s a feature that’s already included and is used from the Firewall screen.',
    prerequisites: [
      'A router or server managed by KrakenOS that applies the rules (it happens underneath, securely).',
      'A clear idea of what you want to allow or block (for example, “keep the camera off the internet”).',
    ],
    steps: [
      {
        title: 'Understand a rule',
        body: 'A firewall rule basically says: “for this kind of traffic, allow it or block it”. You can base it on the source device, the destination or the type of connection (the port and protocol). Order matters: rules are checked top to bottom and the first one that matches is applied.',
      },
      {
        title: 'Start simple',
        body: 'A very common and useful case is stopping a questionable device (a cheap camera, a smart toy) from reaching the internet, leaving it only the local network. Another is blocking a device completely. Create the rule from the Firewall screen and watch the effect.',
        note: 'Start with a single rule and check that it does what you expect before adding more. That way it’s easy to know what each one does.',
      },
      {
        title: 'Review and adjust',
        body: 'After creating a rule, check that the affected device behaves as you wanted (for example, that it no longer reaches the internet). If something stops working by mistake, disable the rule and try again with a different approach.',
        warning: 'Be careful not to lock yourself out of KrakenOS or the internet. If in doubt, start with rules that affect a single device.',
      },
    ],
    troubleshooting: [
      {
        q: 'I created a rule and now something doesn’t work.',
        a: 'Disable or delete the last rule you added and check whether it fixes things. Rules are applied in order, so sometimes a new rule “covers” another. Go one at a time.',
      },
      {
        q: 'What is a “port” and a “protocol”?',
        a: 'The port is like the door number of a service within an address (the web uses 443, for example). The protocol (TCP or UDP) is the language the data travels in. For simple rules you don’t need to touch them.',
      },
    ],
  },
  vlan: {
    displayName: 'Separate networks (VLAN)',
    intro:
      'A VLAN lets you divide your network into separate zones using the same router and the same wiring, as if you put up partitions inside your home. The most common use: having one zone for your computers and phones, and a separate one for smart devices (bulbs, cameras, plugs). That way, if one of those cheap devices had a security flaw, it couldn’t see your personal devices.',
    prerequisites: [
      'Network equipment that supports VLAN (many routers and managed switches do).',
      'An idea of which zones you want to create (for example: “home” and “smart devices”).',
    ],
    steps: [
      {
        title: 'Think in zones',
        body: 'Before creating anything, decide which zones you want. The most common are two: one for your trusted devices (computers, phones) and another for smart devices and guests. Each zone will be a VLAN with its own name.',
      },
      {
        title: 'Create the VLAN',
        body: 'From the VLAN screen, create a new zone with a clear name (for example “IoT”). Underneath, each VLAN carries an identifier number (a “tag”). You can decide whether the zone stays isolated from the rest, which is exactly what you want for smart devices.',
        note: 'The tag is simply the number that identifies the VLAN within the network equipment. It doesn’t have to mean anything special.',
      },
      {
        title: 'Assign devices and check',
        body: 'Place each device in its zone. From then on, devices in an isolated VLAN will have internet but won’t see those in other VLANs. Check that everything that should work still works (for example, controlling your lights from your phone may require allowing that communication between zones).',
        warning: 'Completely isolating smart devices can stop apps on your phone from “discovering” them. If something stops showing up, you may need to allow a small bridge between zones.',
      },
    ],
    troubleshooting: [
      {
        q: 'I put my lights in an isolated VLAN and now I can’t control them.',
        a: 'Full isolation also cuts communication between your phone and the lights. You usually need to allow “discovery” (mDNS) or a specific rule between your phone’s zone and the devices’ zone.',
      },
      {
        q: 'Do I really need VLAN?',
        a: 'No. It’s a recommended security improvement if you have many smart devices, but your network works perfectly well without VLAN. It’s a more advanced step.',
      },
    ],
  },
  qos: {
    displayName: 'Internet priority (QoS)',
    intro:
      'QoS (Quality of Service) is about sharing your internet sensibly. Bandwidth is like the width of a pipe: if someone starts downloading something huge, it can starve a video call or the TV stream. With QoS you give priority to what matters or set a limit on what can hog the connection, so everyone browses smoothly.',
    prerequisites: [
      'A router or server managed by KrakenOS capable of applying traffic control.',
      'Knowing roughly what internet speed you’re paying for (it helps share it well).',
    ],
    steps: [
      {
        title: 'Identify what you want to protect or limit',
        body: 'Think about which activities should never be cut off (video calls, online gaming, live TV) and which devices or uses tend to “eat up” the connection (large downloads, backups). QoS works by giving priority to the former or throttling the latter.',
      },
      {
        title: 'Create a priority or limit rule',
        body: 'From the QoS screen, create a rule: for example, give priority to video-call traffic, or limit the maximum speed of a specific device. Start with one clear rule and watch the result day to day.',
        note: 'If you know your contracted speed, enter it: QoS shares things better when it knows how much “pipe” there is in total.',
      },
      {
        title: 'Adjust based on experience',
        body: 'Try it for a few days. If you notice something important still gets cut off, raise its priority or lower the limit on the device that hogs the connection. QoS is about fine-tuning bit by bit until the connection feels smooth for everyone.',
      },
    ],
    troubleshooting: [
      {
        q: 'I turned on QoS but I don’t notice a difference.',
        a: 'QoS is only noticeable when the connection is saturated (several uses at once). If you have plenty to spare, you won’t see changes. Also make sure you’ve entered your contracted speed correctly.',
      },
      {
        q: 'Does QoS take away speed from me?',
        a: 'It doesn’t reduce your total speed; it just shares it better when there’s competition. A small margin may be reserved so prioritization works, but the goal is for everything to run smoother, not slower.',
      },
    ],
  },
};
