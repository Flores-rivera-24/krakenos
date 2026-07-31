import type { GuideTranslations } from '../localize';

/**
 * Traducción al inglés de las guías de drivers (US-177). Superpone solo el texto
 * visible sobre la fuente en español (`integrations/drivers.ts`); la estructura la
 * toma el original.
 */
export const DRIVERS_GUIDES_EN: GuideTranslations = {
  openwrt: {
    vendor: 'OpenWrt (e.g. TP-Link Archer AX21)',
    intro:
      'OpenWrt is a free system you can install on many routers to gain full control over them. With it, KrakenOS can see every device connected to your home, block the ones you don’t want and change your WiFi name and password, all without relying on any cloud. It’s the most powerful option, but also the most hands-on: you have to replace the router’s internal software.',
    prerequisites: [
      'A router compatible with OpenWrt (for example, the TP-Link Archer AX21). Check the label underneath: it has to show a supported hardware revision (for example “Ver: 1.0” or “Ver: 3.0”).',
      'A network cable (Ethernet). The firmware change is ALWAYS done over a cable, never over WiFi.',
      'A bit of patience and calm: changing the firmware wipes the router’s factory configuration.',
      'The router’s address on your network (we give it to you below) and a password you choose for it.',
    ],
    steps: [
      {
        title: 'First of all: understand the risk',
        body: 'Installing OpenWrt replaces the router’s factory software. If you use the wrong file for your model, the router could become unusable (“bricked”) and you would lose the warranty. It’s not the usual outcome if you’re careful, but it’s worth knowing. Take your time and use the exact file for your revision.',
        warning: 'Always download the firmware for your exact model AND hardware revision. Don’t skip this step.',
      },
      {
        title: 'Download the right firmware',
        body: 'Go to OpenWrt’s official firmware selector, look for your model (for example “Archer AX21”) and pick your revision. Download the image labelled “factory”: that’s the one the router accepts from the factory the first time. The “sysupgrade” version is only for updating once you already have OpenWrt, so don’t use it now.',
      },
      {
        title: 'Install OpenWrt from the router’s web page',
        body: 'Connect your computer to the router with a cable. Open its factory admin panel (on TP-Link it’s usually http://192.168.0.1). Look for the option to update firmware manually (something like “Advanced → System Tools → Firmware Upgrade → Local Upgrade”), upload the “factory” file you downloaded and confirm. The router will reboot into OpenWrt in 2-3 minutes.',
        warning: 'Don’t disconnect the power during the process, even if it seems to be taking a while.',
      },
      {
        title: 'First boot and password',
        body: 'After installing OpenWrt, the router starts responding at the address 192.168.1.1 (careful, it changes from the factory one!). Open http://192.168.1.1 in your browser. The first time there’s no password: the first thing to do is set one. That password is the one you’ll use here below.',
        note: 'Write down the password you set for the router carefully: you’ll need it to connect KrakenOS.',
      },
      {
        title: 'Turn on the WiFi (it comes off)',
        body: 'OpenWrt boots with WiFi disabled for security. Turn it on from its web panel, under “Network → Wireless”: enable each radio (one is 2.4 GHz and the other 5 GHz), give the network a name and a password. From then on, KrakenOS will be able to manage that WiFi for you.',
      },
      {
        title: 'Connect KrakenOS',
        body: 'Fill in the fields below with the router’s address (192.168.1.1), the username (usually “root”) and the password you set. KrakenOS will connect securely and start showing the devices in your home.',
      },
    ],
    fields: {
      host: {
        label: 'Router address',
        help: 'The router’s IP address on your network. After installing OpenWrt it’s usually 192.168.1.1.',
      },
      sshPort: {
        label: 'Connection port',
        help: 'The “door” KrakenOS uses to talk to the router. Leave it at 22 unless you changed it on purpose.',
      },
      username: {
        label: 'Router username',
        help: 'The OpenWrt administrator username. Almost always “root”.',
      },
      password: {
        label: 'Router password',
        help: 'The password you set for OpenWrt on the first boot. It’s stored encrypted.',
      },
      wanInterface: {
        label: 'Internet interface (WAN)',
        help: 'The internal “port” through which the router receives internet. On most routers it’s “wan”; leave it as is if you’re not sure.',
      },
      guestNetwork: {
        label: 'Guest network (optional)',
        help: 'The internal name of the guest network in OpenWrt, if you have one set up. You can leave it as “guest”.',
      },
    },
    troubleshooting: [
      {
        q: 'No devices show up in the inventory.',
        a: 'Check that the address, username and password are correct, and that the router responds at that IP. The first time, the connection will ask you to accept the router’s “fingerprint”: accept it.',
      },
      {
        q: 'I change the WiFi name and it doesn’t apply.',
        a: 'Make sure you enabled the matching radio in OpenWrt and that the user you’re using is an administrator (“root” is one). Check that the WiFi isn’t turned off on the router.',
      },
      {
        q: 'Is it safe to use the password instead of a key?',
        a: 'Yes, as long as your KrakenOS server is on your trusted network. For more advanced setups you can use an SSH key, but to get started the password is enough.',
      },
    ],
  },

  asus: {
    vendor: 'ASUS / Asuswrt-Merlin',
    intro:
      'If you have an ASUS router (like the RT-AX88U, RT-AX86U, ZenWiFi or TUF Gaming), KrakenOS can connect to it using the same admin panel you open in your browser. You’ll be able to see who’s connected, block devices and change your WiFi. It works both with the original ASUS firmware and with the popular Asuswrt-Merlin. There’s nothing odd to install: just enable local access and give us the router’s username and password.',
    prerequisites: [
      'An ASUS router connected to your network.',
      'The router’s admin username and password (the same ones you use to log in to its panel).',
      'The router’s local web access enabled (we explain how).',
    ],
    steps: [
      {
        title: 'Enable the router’s local access',
        body: 'Open the ASUS router’s panel in your browser and go to “Administration → System”. Under “Local Access Config” make sure local web access is allowed. If you’d rather it use HTTPS (an encrypted connection), enable it here and tick the HTTPS box further down.',
      },
      {
        title: 'Note down the username and password',
        body: 'You need the router’s admin username and password. They’re the same ones you use to log in to its configuration panel. If you never changed them, look on the router’s label.',
      },
      {
        title: 'Check the MAC filter (important for blocking)',
        body: 'Blocking devices on ASUS routers uses the router’s “MAC address filter”. For it to work properly, that filter must be in “blacklist” mode (block the ones on the list), not in “whitelist” mode (only allow the ones on the list). You check it under “Firewall → MAC filter”. If you have it on whitelist, it’s better not to use blocking from KrakenOS.',
        note: 'The MAC is each device’s unique serial number. KrakenOS uses it to know who to block.',
      },
      {
        title: 'Connect KrakenOS',
        body: 'Fill in the router’s address (usually 192.168.1.1), the username and the password. If you enabled HTTPS in step 1, tick that box. Once you save, you’ll see the connected devices and your 2.4 and 5 GHz WiFi.',
      },
    ],
    fields: {
      host: {
        label: 'Router address',
        help: 'The ASUS router’s IP address on your network. Most often it’s 192.168.1.1.',
      },
      username: {
        label: 'Admin username',
        help: 'The username you use to log in to the router’s panel. Usually “admin”.',
      },
      password: {
        label: 'Admin password',
        help: 'The router’s admin password. It’s stored encrypted and not shown again.',
      },
      https: {
        label: 'The router uses HTTPS',
        help: 'Enable it only if in step 1 you set the router’s panel to HTTPS (an encrypted connection). Otherwise, leave it off.',
      },
    },
    troubleshooting: [
      {
        q: 'I block a device but it stays connected.',
        a: 'Check that the router’s MAC filter is in “blacklist” mode (deny). In “whitelist” mode blocking won’t work as you’d expect.',
      },
      {
        q: 'I don’t see each device’s traffic separately.',
        a: 'That’s normal: ASUS routers only report total internet usage, not per device. You’ll see the overall speed, not a breakdown by device.',
      },
      {
        q: 'I can’t find the guest network.',
        a: 'The ASUS guest network is managed from the router’s own panel; KrakenOS doesn’t change it in this version.',
      },
    ],
  },

  unifi: {
    displayName: 'Ubiquiti UniFi',
    vendor: 'Ubiquiti',
    intro:
      'If you have Ubiquiti UniFi gear (a Dream Machine, a Cloud Key or the UniFi Network application on a PC), KrakenOS talks directly to your controller inside your home, without going through Ubiquiti’s cloud. You’ll see the connected devices, be able to block them and change your WiFi networks. You just need to create a local account on the controller and give us its details.',
    prerequisites: [
      'A working UniFi controller (Dream Machine/Router, Cloud Key or the self-hosted UniFi Network app).',
      'The controller’s web address (we give examples below).',
      'Permission to create a local admin account on it.',
    ],
    steps: [
      {
        title: 'Find your controller’s address',
        body: 'If you have a UniFi OS device (Dream Machine, Cloud Key Gen2), the address is usually https://192.168.1.1. If you use the UniFi Network application installed on a computer or server, it’s usually https://the-server-ip:8443. That full address is the one you’ll enter below.',
      },
      {
        title: 'Create a LOCAL account (not the cloud one)',
        body: 'The Ubiquiti account you use in the mobile app (the cloud one) doesn’t work here. Log in to the controller as an administrator and go to “Settings → Admins” (or “Admins & Users”). Create a new administrator ticking the “Restrict to local access only” option. Give it a username and password.',
        note: 'To view devices, read permission is enough; to block and change the WiFi it needs write permission over the network.',
      },
      {
        title: 'Choose the site (if you have several)',
        body: 'UniFi organizes networks into “sites”. If you only have your home, it’ll be “default” and you don’t have to touch anything. If you manage several locations, enter the name of the site that controls your home.',
      },
      {
        title: 'Connect KrakenOS',
        body: 'Enter the controller’s address, the username and password of the local account you created, and the site. KrakenOS will accept the controller’s local certificate automatically. Once you save, you’ll see your inventory and your WiFi networks.',
      },
    ],
    fields: {
      url: {
        label: 'Controller address',
        help: 'The full web address, with https://. For example https://192.168.1.1 or https://192.168.1.10:8443.',
      },
      username: {
        label: 'Local username',
        help: 'The username of the local account you created on the controller (not your Ubiquiti cloud one).',
      },
      password: {
        label: 'Password',
        help: 'The password of that local account. It’s stored encrypted.',
      },
      site: {
        label: 'Site',
        help: 'The name of the UniFi site that manages your home. If you only have one, leave it as “default”.',
      },
    },
    troubleshooting: [
      {
        q: 'I get an error when logging in.',
        a: 'Make sure you use the LOCAL account (created with “Restrict to local access only”), not your Ubiquiti cloud account. Also check that the address includes https:// and the right port.',
      },
      {
        q: 'The browser or the system warns about an untrusted certificate.',
        a: 'That’s normal: the controller uses a certificate it made itself for your local network. KrakenOS accepts it automatically because it’s a connection inside your home.',
      },
      {
        q: 'I don’t see per-device usage.',
        a: 'UniFi, through this connection, only reports total internet speed, not the breakdown by device.',
      },
    ],
  },

  omada: {
    displayName: 'TP-Link Omada',
    vendor: 'TP-Link',
    intro:
      'Omada is TP-Link’s professional system for managing access points, switches and routers from a central controller (it can be a program on a PC or a little OC200/OC300 box). KrakenOS connects to that controller inside your network to see the connected devices, block them and change your WiFi. It only uses the local controller, never the Omada cloud.',
    prerequisites: [
      'A working Omada controller on your network (software on a PC/Docker, or an OC200/OC300).',
      'The access points must be managed by the controller (not in loose/standalone mode).',
      'Being able to create a local admin account on the controller.',
    ],
    steps: [
      {
        title: 'Find the controller’s address',
        body: 'The software version (v5) usually responds at https://the-ip:8043. The OC200/OC300 devices usually use https://the-ip:443. That full address is the one you’ll enter below.',
      },
      {
        title: 'Create a local admin account',
        body: 'Log in to the controller as an administrator and go to “Settings → Admin” (or “Account”). Create a local administrator (not the TP-Link cloud account) with permission over the site that manages your home. That username and password are the ones you’ll use here.',
      },
      {
        title: 'Confirm the site name',
        body: 'Omada organizes the network into “sites”. The default name is usually “Default”. Type it exactly as it appears in the controller (mind the capitals). The controller’s internal identifier is detected automatically, so you can leave that field empty.',
      },
      {
        title: 'Connect KrakenOS',
        body: 'Enter the controller’s address, the local username and password, and the site name. Once you save, you’ll see the connected devices and the site’s WiFi.',
      },
    ],
    fields: {
      url: {
        label: 'Controller address',
        help: 'The full web address with https://. For example https://192.168.1.10:8043 (software) or https://192.168.1.10:443 (OC200/OC300).',
      },
      username: {
        label: 'Local username',
        help: 'The username of the controller’s local admin account (not the TP-Link cloud one).',
      },
      password: {
        label: 'Password',
        help: 'The password of that local account. It’s stored encrypted.',
      },
      siteName: {
        label: 'Site name',
        help: 'The exact name of the site in Omada (mind the capitals). By default it’s usually “Default”.',
      },
      omadacId: {
        label: 'Controller ID (optional)',
        help: 'An internal identifier of the controller. Leave it empty: KrakenOS detects it automatically.',
      },
    },
    troubleshooting: [
      {
        q: 'It can’t find my site.',
        a: 'Type the site name exactly as it appears in the controller, respecting upper and lower case (by default “Default”).',
      },
      {
        q: 'The access points don’t show up.',
        a: 'They must be “adopted” by the Omada controller. APs in loose (standalone) mode don’t work with this connection.',
      },
      {
        q: 'It fails when changing a WiFi.',
        a: 'Some controller versions use different paths for the WiFi. Check that your user has write permission over the site.',
      },
    ],
  },

  mikrotik: {
    displayName: 'MikroTik RouterOS',
    vendor: 'MikroTik',
    intro:
      'MikroTik makes very powerful routers (hEX, RB4011, CRS, CCR and more) that run a system called RouterOS. KrakenOS can manage them in two ways: the modern one (REST API, for RouterOS 7) or the classic one (over SSH, for RouterOS 6). You’ll be able to see the connected devices, block them and, if your MikroTik has WiFi, manage it. It requires enabling an option on the router and creating a user.',
    prerequisites: [
      'A MikroTik router on your network and admin access to it.',
      'Knowing whether your RouterOS is version 7 (uses REST mode) or version 6 (uses SSH mode).',
      'Being able to create a user with permissions on the router.',
    ],
    steps: [
      {
        title: 'Choose the mode based on your version',
        body: 'If your router has RouterOS 7 (the common one today), use “REST” mode, which is simpler. If it has RouterOS 6, use “SSH” mode. You can check your version in the router’s panel.',
      },
      {
        title: 'REST mode: enable the web service',
        body: 'On RouterOS 7, enable the secure web service so the API responds. From the router’s terminal run the command below and check that “www-ssl” (or “www”) shows up as active.',
      },
      {
        title: 'SSH mode: enable SSH',
        body: 'If you’re going to use SSH mode (RouterOS 6), enable SSH access on the router with the command below. In this mode, KrakenOS translates its actions into router commands.',
      },
      {
        title: 'Create a user with permissions',
        body: 'Instead of using “admin”, create a dedicated user for KrakenOS. Read permission is enough to see devices and traffic; add write permission if you want to block devices and change the WiFi.',
        command:
          '/user group add name=krakenos policy=read,write,api,rest-api,!ftp,!telnet\n/user add name=krakenos group=krakenos password=YOUR_PASSWORD',
      },
      {
        title: 'Connect KrakenOS',
        body: 'Choose the mode (REST or SSH), enter the router’s address (often 192.168.88.1), the username and password you created, and the name of your router’s internet port (WAN). Once you save, you’ll see the inventory.',
      },
    ],
    fields: {
      mode: {
        label: 'Connection mode',
        help: 'REST for RouterOS 7 (recommended). SSH for RouterOS 6 or if REST isn’t available.',
        options: {
          rest: 'REST (RouterOS 7)',
          ssh: 'SSH (RouterOS 6)',
        },
      },
      host: {
        label: 'Router address',
        help: 'The MikroTik’s IP address on your network. By factory default it’s usually 192.168.88.1.',
      },
      username: {
        label: 'Username',
        help: 'The user you created for KrakenOS on the router.',
      },
      password: {
        label: 'Password',
        help: 'That user’s password. It’s stored encrypted.',
      },
      wanInterface: {
        label: 'Internet port (WAN)',
        help: 'The name of the interface through which internet comes in, to measure traffic. On many MikroTiks it’s “ether1”; adjust it to your router.',
      },
      https: {
        label: 'Use an encrypted connection (HTTPS)',
        help: 'Only in REST mode. Leave it enabled unless your router only has the unencrypted “www” service.',
      },
      sshPort: {
        label: 'SSH port',
        help: 'Only in SSH mode. The door it connects through; usually 22.',
      },
    },
    troubleshooting: [
      {
        q: 'It doesn’t connect in REST mode.',
        a: 'Check that you enabled the “www-ssl” (or “www”) service and that your RouterOS is version 7. If your router only has unencrypted “www”, turn off the HTTPS box.',
      },
      {
        q: 'The WiFi options give an error.',
        a: 'Only MikroTiks with built-in WiFi support it. Models like hEX, RB4011, CRS or CCR have no radio, so they don’t appear as an access point.',
      },
      {
        q: 'I blocked a device and want to undo it.',
        a: 'When you unblock, KrakenOS removes the device’s entry from the blocked list. The general blocking rule stays on the router, ready for future blocks.',
      },
    ],
  },

  pfsense: {
    vendor: 'Netgate',
    intro:
      'pfSense is a very complete firewall and router that many people install on a mini-PC to govern their network. KrakenOS connects to it through its API to see the connected devices and block the ones you want. Since pfSense is a router-firewall (not an access point), WiFi management doesn’t apply: your separate antennas handle that.',
    prerequisites: [
      'A working pfSense on your network, with admin access.',
      'The REST API package installed and enabled on pfSense (version 2), which lets you create an access key.',
      'Your pfSense web address.',
    ],
    steps: [
      {
        title: 'Enable the API in pfSense',
        body: 'In the pfSense panel, install/enable the REST API package (v2) and turn it on. That’s what lets other apps, like KrakenOS, connect in a controlled way.',
      },
      {
        title: 'Generate an access key (API key)',
        body: 'Inside the API settings, create a key for KrakenOS. An API key is like a long password that identifies the app without using your personal account. Copy it as soon as you generate it: for security, it’s sometimes shown only once.',
        note: 'Treat the key like a password: don’t share it. It will be stored encrypted.',
      },
      {
        title: 'Connect KrakenOS',
        body: 'Enter your pfSense web address and the access key. Also indicate which is the internet port (WAN) and which is your local network one (LAN); on most installations they are “wan” and “lan”. Once you save, you’ll see the device inventory.',
      },
    ],
    fields: {
      baseUrl: {
        label: 'pfSense address',
        help: 'Your pfSense web address, with https://. For example https://192.168.1.1.',
      },
      apiKey: {
        label: 'Access key (API key)',
        help: 'The key you generated in the pfSense API settings. It’s stored encrypted and not shown again.',
      },
      wanInterface: {
        label: 'Internet interface (WAN)',
        help: 'The name of the interface through which internet comes in. On pfSense it’s usually “wan”.',
      },
      lanInterface: {
        label: 'Local network interface (LAN)',
        help: 'The name of your internal network’s interface. On pfSense it’s usually “lan”.',
      },
    },
    troubleshooting: [
      {
        q: 'The connection is refused.',
        a: 'Check that the API package is installed and enabled, that the address includes https:// and that the access key is correct and hasn’t expired.',
      },
      {
        q: 'Can I manage the WiFi from here?',
        a: 'No. pfSense is a router-firewall, not a WiFi access point. Your WiFi antennas are managed on their own; this integration covers inventory and blocking.',
      },
    ],
  },

  mock: {
    displayName: 'Demo mode',
    intro:
      'Demo mode simulates a house full of devices, WiFi networks and traffic, without needing any real hardware. It’s perfect for exploring KrakenOS at your own pace, learning where everything is and trying the buttons (block, change WiFi, etc.) with no fear of breaking anything. When you’re ready to control your real network, pick your router’s driver.',
    prerequisites: ['Nothing. Demo mode works as is, with no data or devices.'],
    steps: [
      {
        title: 'Turn it on and explore',
        body: 'Demo mode asks for no configuration. Once you turn it on, you’ll see a sample inventory with devices, simulated WiFi networks and traffic charts that move on their own. Everything is fictional and safe: you can touch anything.',
      },
      {
        title: 'When you’re ready, connect your real router',
        body: 'When you feel comfortable, go back to the wizard and pick your router’s model (OpenWrt, ASUS, UniFi, Omada, MikroTik…). From then on, KrakenOS will show and manage your real network instead of the simulated one.',
      },
    ],
    troubleshooting: [
      {
        q: 'Are the devices I see real?',
        a: 'No. In demo mode everything is simulated so you can explore. To see your real devices, connect your router’s driver.',
      },
      {
        q: 'Can I do any harm trying things here?',
        a: 'Not at all. Nothing you do in demo mode affects your real network, because there isn’t one connected.',
      },
    ],
  },
};
