import type { IntegrationGuide } from '../../types';

/**
 * English versions of the router/switch driver guides (domain 'driver',
 * category 'router'). Prose translated from the Spanish source (drivers.ts).
 * Technical fields (id, kind, keys, commands, defaults) are kept IDENTICAL to
 * the source so the backend contract holds; only human-facing prose is translated.
 */

const openwrt: IntegrationGuide = {
  id: 'openwrt',
  domain: 'driver',
  kind: 'openwrt',
  category: 'router',
  displayName: 'OpenWrt',
  vendor: 'OpenWrt (e.g. TP-Link Archer AX21)',
  icon: 'Router',
  tier: 4,
  wifiSupported: true,
  intro:
    'OpenWrt is free software that you can install on many routers to gain full control over them. With it, KrakenOS can see every device connected in your home, block the ones you do not want and change your WiFi name and password, all without relying on any cloud. It is the most powerful option, but also the most hands-on: you have to replace the router’s internal software.',
  prerequisites: [
    'A router that supports OpenWrt (for example, the TP-Link Archer AX21). Check the label on the bottom: it must list a supported hardware revision (for example "Ver: 1.0" or "Ver: 3.0").',
    'A network (Ethernet) cable. The firmware change is ALWAYS done over a cable, never over WiFi.',
    'Some patience and a calm head: changing the firmware wipes the router’s factory configuration.',
    'The router’s address on your network (we give it below) and a password of your own choosing for it.',
  ],
  steps: [
    {
      title: 'First of all: understand the risk',
      body: 'Installing OpenWrt replaces the router’s factory software. If you use the wrong file for your model, the router could become unusable (a "brick") and you would void the warranty. It is not common if you are careful, but it is worth knowing. Take your time and use the exact file for your revision.',
      warning: 'Always download the firmware for your exact model AND hardware revision. Do not skip this step.',
      external: true,
    },
    {
      title: 'Download the correct firmware',
      body: 'Go to the official OpenWrt firmware selector, search for your model (for example "Archer AX21") and pick your revision. Download the image labelled "factory": that is the one the factory router accepts the first time. The "sysupgrade" version is only for updating once you already have OpenWrt, so do not use it now.',
      command: 'https://firmware-selector.openwrt.org/',
      external: true,
    },
    {
      title: 'Install OpenWrt from the router’s web page',
      body: 'Connect your computer to the router with a cable. Open its factory admin panel (on TP-Link it is usually http://192.168.0.1). Find the option to update the firmware manually (something like "Advanced → System Tools → Firmware Upgrade → Local Upgrade"), upload the "factory" file you downloaded and confirm. The router will reboot into OpenWrt in 2-3 minutes.',
      warning: 'Do not cut the power during the process, even if it seems to be taking a while.',
      external: true,
    },
    {
      title: 'First boot and password',
      body: 'After installing OpenWrt, the router starts responding at the address 192.168.1.1 (careful, this changes from the factory one!). Open http://192.168.1.1 in your browser. The first time there is no password: the very first thing to do is set one. That password is the one you will use here below.',
      note: 'Write down the password you set on the router carefully: you will need it to connect KrakenOS.',
      external: true,
    },
    {
      title: 'Turn on the WiFi (it comes off)',
      body: 'OpenWrt boots with WiFi disabled for security. Turn it on from its web panel, under "Network → Wireless": switch on each radio (one is 2.4 GHz and the other 5 GHz), give the network a name and a password. From then on, KrakenOS will be able to manage that WiFi for you.',
      external: true,
    },
    {
      title: 'Connect KrakenOS',
      body: 'Fill in the fields below with the router’s address (192.168.1.1), the username (usually "root") and the password you set. KrakenOS will connect securely and start showing the devices in your home.',
    },
  ],
  fields: [
    {
      key: 'host',
      label: 'Router address',
      help: 'The router’s IP address on your network. After installing OpenWrt it is usually 192.168.1.1.',
      type: 'host',
      placeholder: '192.168.1.1',
      required: true,
    },
    {
      key: 'sshPort',
      label: 'Connection port',
      help: 'The "door" KrakenOS uses to talk to the router. Leave it at 22 unless you changed it on purpose.',
      type: 'number',
      required: false,
      defaultValue: 22,
    },
    {
      key: 'username',
      label: 'Router username',
      help: 'The OpenWrt administrator username. Almost always "root".',
      type: 'text',
      placeholder: 'root',
      required: true,
    },
    {
      key: 'password',
      label: 'Router password',
      help: 'The password you set for OpenWrt on first boot. It is stored encrypted.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'wanInterface',
      label: 'Internet interface (WAN)',
      help: 'The internal "port" through which the router receives internet. On most routers it is "wan"; leave it as is if you are unsure.',
      type: 'text',
      placeholder: 'wan',
      required: false,
      defaultValue: 'wan',
    },
    {
      key: 'guestNetwork',
      label: 'Guest network (optional)',
      help: 'The internal name of the guest network in OpenWrt, if you have one set up. You can leave it as "guest".',
      type: 'text',
      placeholder: 'guest',
      required: false,
      defaultValue: 'guest',
    },
  ],
  troubleshooting: [
    {
      q: 'No devices show up in the inventory.',
      a: 'Check that the address, username and password are correct, and that the router responds at that IP. The first time, the connection will ask you to accept the router’s "fingerprint": accept it.',
    },
    {
      q: 'I change the WiFi name and it does not apply.',
      a: 'Make sure you turned on the relevant radio in OpenWrt and that the user you are using is an administrator ("root" is). Check that the WiFi is not switched off on the router.',
    },
    {
      q: 'Is it safe to use the password instead of a key?',
      a: 'Yes, as long as your KrakenOS server is on your trusted network. For more advanced setups you can use an SSH key, but to get started the password is enough.',
    },
  ],
};

const asus: IntegrationGuide = {
  id: 'asus',
  domain: 'driver',
  kind: 'asus',
  category: 'router',
  displayName: 'ASUS',
  vendor: 'ASUS / Asuswrt-Merlin',
  icon: 'Router',
  tier: 2,
  wifiSupported: true,
  intro:
    'If you have an ASUS router (such as the RT-AX88U, RT-AX86U, ZenWiFi or TUF Gaming), KrakenOS can connect to it using the same admin panel you open in your browser. You will be able to see who is connected, block devices and change your WiFi. It works with both the original ASUS firmware and the popular Asuswrt-Merlin. There is nothing odd to install: just enable local access and give us the router’s username and password.',
  prerequisites: [
    'An ASUS router connected to your network.',
    'The router’s admin username and password (the same ones you use to log into its panel).',
    'The router’s local web access enabled (we explain how).',
  ],
  steps: [
    {
      title: 'Enable the router’s local access',
      body: 'Open the ASUS router panel in your browser and go to "Administration → System". Under "Local Access Config" make sure web access over the local network is allowed. If you prefer it to use HTTPS (an encrypted connection), enable it here and tick the HTTPS box below.',
      external: true,
    },
    {
      title: 'Note down the username and password',
      body: 'You need the router’s admin username and password. They are the same ones you use to log into its configuration panel. If you never changed them, check the router’s label.',
      external: true,
    },
    {
      title: 'Check the MAC filter (important for blocking)',
      body: 'Blocking devices on ASUS routers uses the router’s "MAC address filter". For it to work properly, that filter must be in "blacklist" mode (block those on the list), not "whitelist" mode (allow only those on the list). You can check it under "Firewall → MAC filter". If you have it in whitelist mode, it is better not to use blocking from KrakenOS.',
      note: 'The MAC is each device’s unique serial number. KrakenOS uses it to know who to block.',
      external: true,
    },
    {
      title: 'Connect KrakenOS',
      body: 'Fill in the router’s address (usually 192.168.1.1), the username and the password. If you enabled HTTPS in step 1, tick that box. On saving, you will see the connected devices and your 2.4 and 5 GHz WiFi.',
    },
  ],
  fields: [
    {
      key: 'host',
      label: 'Router address',
      help: 'The ASUS router’s IP address on your network. Most commonly 192.168.1.1.',
      type: 'host',
      placeholder: '192.168.1.1',
      required: true,
    },
    {
      key: 'username',
      label: 'Admin username',
      help: 'The user you log into the router panel with. Usually "admin".',
      type: 'text',
      placeholder: 'admin',
      required: true,
    },
    {
      key: 'password',
      label: 'Admin password',
      help: 'The router’s admin password. It is stored encrypted and never shown again.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'https',
      label: 'The router uses HTTPS',
      help: 'Enable it only if in step 1 you set the router panel to HTTPS (encrypted connection). Otherwise, leave it off.',
      type: 'boolean',
      required: false,
      defaultValue: false,
    },
  ],
  troubleshooting: [
    {
      q: 'I block a device but it stays connected.',
      a: 'Check that the router’s MAC filter is in "blacklist" (deny) mode. In "whitelist" mode blocking does not work as you expect.',
    },
    {
      q: 'I cannot see the traffic of each device separately.',
      a: 'That is normal: ASUS routers only report total internet usage, not per device. You will see the overall speed, not a per-device breakdown.',
    },
    {
      q: 'I cannot find the guest network.',
      a: 'The ASUS guest network is managed from the router’s own panel; KrakenOS does not modify it in this version.',
    },
  ],
};

const unifi: IntegrationGuide = {
  id: 'unifi',
  domain: 'driver',
  kind: 'unifi',
  category: 'router',
  displayName: 'Ubiquiti UniFi',
  vendor: 'Ubiquiti',
  icon: 'Network',
  tier: 2,
  wifiSupported: true,
  intro:
    'If you have Ubiquiti UniFi gear (a Dream Machine, a Cloud Key or the UniFi Network application on a PC), KrakenOS talks directly to your controller inside your home, without going through the Ubiquiti cloud. You will see the connected devices, be able to block them and change your WiFi networks. You just need to create a local account on the controller and give us its details.',
  prerequisites: [
    'A working UniFi controller (Dream Machine/Router, Cloud Key or the self-hosted UniFi Network app).',
    'The controller’s web address (we give examples below).',
    'Permission to create a local admin account on it.',
  ],
  steps: [
    {
      title: 'Find your controller’s address',
      body: 'If you have a UniFi OS device (Dream Machine, Cloud Key Gen2), the address is usually https://192.168.1.1. If you use the UniFi Network application installed on a computer or server, it is usually https://the-server-ip:8443. That full address is what you will enter below.',
      external: true,
    },
    {
      title: 'Create a LOCAL account (not the cloud one)',
      body: 'The Ubiquiti account you use in the phone app (the cloud one) does not work here. Log into the controller as an administrator and go to "Settings → Admins" (or "Admins & Users"). Create a new administrator ticking the "Restrict to local access only" option. Give it a username and password.',
      note: 'Read access is enough to see devices; to block and change WiFi it needs write access over the network.',
      external: true,
    },
    {
      title: 'Choose the site (if you have several)',
      body: 'UniFi organises networks into "sites". If you only have your home, it will be "default" and you do not need to touch anything. If you manage several locations, indicate the name of the site that controls your home.',
      external: true,
    },
    {
      title: 'Connect KrakenOS',
      body: 'Enter the controller’s address, the username and password of the local account you created, and the site. KrakenOS will accept the controller’s local certificate automatically. On saving, you will see your inventory and your WiFi networks.',
    },
  ],
  fields: [
    {
      key: 'url',
      label: 'Controller address',
      help: 'The full web address, with https://. For example https://192.168.1.1 or https://192.168.1.10:8443.',
      type: 'url',
      placeholder: 'https://192.168.1.1',
      required: true,
    },
    {
      key: 'username',
      label: 'Local username',
      help: 'The username of the local account you created on the controller (not the Ubiquiti cloud one).',
      type: 'text',
      placeholder: 'krakenos',
      required: true,
    },
    {
      key: 'password',
      label: 'Password',
      help: 'The password of that local account. It is stored encrypted.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'site',
      label: 'Site',
      help: 'The name of the UniFi site that manages your home. If you only have one, leave it as "default".',
      type: 'text',
      placeholder: 'default',
      required: false,
      defaultValue: 'default',
    },
  ],
  troubleshooting: [
    {
      q: 'I get an error when logging in.',
      a: 'Make sure you use the LOCAL account (created with "Restrict to local access only"), not your Ubiquiti cloud account. Also check that the address includes https:// and the correct port.',
    },
    {
      q: 'The browser or the system warns about an untrusted certificate.',
      a: 'That is normal: the controller uses a certificate it made itself for your local network. KrakenOS accepts it automatically because it is a connection inside your home.',
    },
    {
      q: 'I cannot see per-device usage.',
      a: 'UniFi, through this connection, only reports the total internet speed, not the per-device breakdown.',
    },
  ],
};

const omada: IntegrationGuide = {
  id: 'omada',
  domain: 'driver',
  kind: 'omada',
  category: 'router',
  displayName: 'TP-Link Omada',
  vendor: 'TP-Link',
  icon: 'Network',
  tier: 2,
  wifiSupported: true,
  intro:
    'Omada is TP-Link’s professional system for managing access points, switches and routers from a central controller (it can be a program on a PC or a small OC200/OC300 box). KrakenOS connects to that controller inside your network to see the connected devices, block them and change your WiFi. It only uses the local controller, never the Omada cloud.',
  prerequisites: [
    'A working Omada controller on your network (software on a PC/Docker, or an OC200/OC300).',
    'The access points must be managed by the controller (not in standalone mode).',
    'Being able to create a local admin account on the controller.',
  ],
  steps: [
    {
      title: 'Find the controller’s address',
      body: 'The software version (v5) usually responds at https://the-ip:8043. The OC200/OC300 devices usually use https://the-ip:443. That full address is what you will enter below.',
      external: true,
    },
    {
      title: 'Create a local admin account',
      body: 'Log into the controller as an administrator and go to "Settings → Admin" (or "Account"). Create a local admin (not the TP-Link cloud account) with permission over the site that manages your home. That username and password are the ones you will use here.',
      external: true,
    },
    {
      title: 'Confirm the site name',
      body: 'Omada organises the network into "sites". The default name is usually "Default". Write it exactly as it appears in the controller (mind the capitalisation). The controller’s internal identifier is detected automatically, so you can leave that field empty.',
      external: true,
    },
    {
      title: 'Connect KrakenOS',
      body: 'Enter the controller’s address, the local username and password, and the site name. On saving, you will see the connected devices and the site’s WiFi networks.',
    },
  ],
  fields: [
    {
      key: 'url',
      label: 'Controller address',
      help: 'The full web address with https://. For example https://192.168.1.10:8043 (software) or https://192.168.1.10:443 (OC200/OC300).',
      type: 'url',
      placeholder: 'https://192.168.1.10:8043',
      required: true,
    },
    {
      key: 'username',
      label: 'Local username',
      help: 'The username of the controller’s local admin account (not the TP-Link cloud one).',
      type: 'text',
      placeholder: 'krakenos',
      required: true,
    },
    {
      key: 'password',
      label: 'Password',
      help: 'The password of that local account. It is stored encrypted.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'siteName',
      label: 'Site name',
      help: 'The exact site name in Omada (mind the capitalisation). By default it is usually "Default".',
      type: 'text',
      placeholder: 'Default',
      required: false,
      defaultValue: 'Default',
    },
    {
      key: 'omadacId',
      label: 'Controller ID (optional)',
      help: 'An internal controller identifier. Leave it empty: KrakenOS detects it automatically.',
      type: 'text',
      required: false,
    },
  ],
  troubleshooting: [
    {
      q: 'It cannot find my site.',
      a: 'Write the site name exactly as it appears in the controller, respecting upper and lower case (by default "Default").',
    },
    {
      q: 'The access points do not show up.',
      a: 'They must be "adopted" by the Omada controller. APs in standalone mode do not work with this connection.',
    },
    {
      q: 'It fails when changing a WiFi network.',
      a: 'Some controller versions use different paths for WiFi. Check that your user has write access over the site.',
    },
  ],
};

const mikrotik: IntegrationGuide = {
  id: 'mikrotik',
  domain: 'driver',
  kind: 'mikrotik',
  category: 'router',
  displayName: 'MikroTik RouterOS',
  vendor: 'MikroTik',
  icon: 'Router',
  tier: 3,
  wifiSupported: true,
  intro:
    'MikroTik makes very powerful routers (hEX, RB4011, CRS, CCR and more) that run a system called RouterOS. KrakenOS can manage them in two ways: the modern one (REST API, for RouterOS 7) or the classic one (over SSH, for RouterOS 6). You will be able to see the connected devices, block them and, if your MikroTik has WiFi, manage it. It requires enabling an option on the router and creating a user.',
  prerequisites: [
    'A MikroTik router on your network and admin access to it.',
    'Knowing whether your RouterOS is version 7 (uses REST mode) or version 6 (uses SSH mode).',
    'Being able to create a user with permissions on the router.',
  ],
  steps: [
    {
      title: 'Choose the mode based on your version',
      body: 'If your router has RouterOS 7 (the common case today), use "REST" mode, which is simpler. If it has RouterOS 6, use "SSH" mode. You can check your version in the router’s panel.',
      external: true,
    },
    {
      title: 'REST mode: enable the web service',
      body: 'On RouterOS 7, enable the secure web service so the API responds. From the router’s terminal run the command below and check that "www-ssl" (or "www") shows as active.',
      command: '/ip service enable www-ssl\n/ip service print',
      external: true,
    },
    {
      title: 'SSH mode: enable SSH',
      body: 'If you are going to use SSH mode (RouterOS 6), enable SSH access on the router with the command below. In this mode, KrakenOS translates its actions into router commands.',
      command: '/ip service enable ssh',
      external: true,
    },
    {
      title: 'Create a user with permissions',
      body: 'Instead of using "admin", create a dedicated user for KrakenOS. Read permission is enough to see devices and traffic; add write permission if you want to block devices and change the WiFi.',
      command:
        '/user group add name=krakenos policy=read,write,api,rest-api,!ftp,!telnet\n/user add name=krakenos group=krakenos password=TU_PASSWORD',
      external: true,
    },
    {
      title: 'Connect KrakenOS',
      body: 'Choose the mode (REST or SSH), enter the router’s address (often 192.168.88.1), the username and password you created, and the name of your router’s internet (WAN) port. On saving, you will see the inventory.',
    },
  ],
  fields: [
    {
      key: 'mode',
      label: 'Connection mode',
      help: 'REST for RouterOS 7 (recommended). SSH for RouterOS 6 or if REST is not available.',
      type: 'select',
      required: true,
      defaultValue: 'rest',
      options: [
        { value: 'rest', label: 'REST (RouterOS 7)' },
        { value: 'ssh', label: 'SSH (RouterOS 6)' },
      ],
    },
    {
      key: 'host',
      label: 'Router address',
      help: 'The MikroTik’s IP address on your network. The factory default is usually 192.168.88.1.',
      type: 'host',
      placeholder: '192.168.88.1',
      required: true,
    },
    {
      key: 'username',
      label: 'Username',
      help: 'The user you created for KrakenOS on the router.',
      type: 'text',
      placeholder: 'krakenos',
      required: true,
    },
    {
      key: 'password',
      label: 'Password',
      help: 'The password of that user. It is stored encrypted.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'wanInterface',
      label: 'Internet port (WAN)',
      help: 'The name of the interface through which internet comes in, used to measure traffic. On many MikroTiks it is "ether1"; adjust it to your router.',
      type: 'text',
      placeholder: 'ether1',
      required: false,
      defaultValue: 'ether1',
    },
    {
      key: 'https',
      label: 'Use encrypted connection (HTTPS)',
      help: 'REST mode only. Leave it on unless your router only has the unencrypted "www" service.',
      type: 'boolean',
      required: false,
      defaultValue: true,
    },
    {
      key: 'sshPort',
      label: 'SSH port',
      help: 'SSH mode only. The door it connects through; usually 22.',
      type: 'number',
      required: false,
      defaultValue: 22,
    },
  ],
  troubleshooting: [
    {
      q: 'It will not connect in REST mode.',
      a: 'Check that you enabled the "www-ssl" (or "www") service and that your RouterOS is version 7. If your router only has the unencrypted "www", turn off the HTTPS box.',
    },
    {
      q: 'The WiFi options give an error.',
      a: 'Only MikroTiks with built-in WiFi support it. Models like the hEX, RB4011, CRS or CCR have no radio, so they do not show up as an access point.',
    },
    {
      q: 'I block a device and want to undo it.',
      a: 'When you unblock, KrakenOS removes the device’s entry from the blocked list. The general blocking rule stays on the router, ready for future blocks.',
    },
  ],
};

const pfsense: IntegrationGuide = {
  id: 'pfsense',
  domain: 'driver',
  kind: 'pfsense',
  category: 'router',
  displayName: 'pfSense',
  vendor: 'Netgate',
  icon: 'Router',
  tier: 3,
  wifiSupported: false,
  intro:
    'pfSense is a very complete firewall and router that many people install on a mini-PC to govern their network. KrakenOS connects to it through its API to see the connected devices and block the ones you want. Because pfSense is a router-firewall (not an access point), WiFi management does not apply: that is handled by your separate access points.',
  prerequisites: [
    'A working pfSense on your network, with admin access.',
    'The REST API package installed and enabled on pfSense (version 2), which lets you create an access key.',
    'Your pfSense’s web address.',
  ],
  steps: [
    {
      title: 'Enable the API on pfSense',
      body: 'In the pfSense panel, install/enable the REST API package (v2) and turn it on. That is what lets other apps, such as KrakenOS, connect in a controlled way.',
      external: true,
    },
    {
      title: 'Generate an access key (API key)',
      body: 'Within the API configuration, create a key for KrakenOS. An API key is like a long password that identifies the app without using your personal account. Copy it as soon as you generate it: for security, it is sometimes only shown once.',
      note: 'Treat the key like a password: do not share it. It will be stored encrypted.',
      external: true,
    },
    {
      title: 'Connect KrakenOS',
      body: 'Enter your pfSense’s web address and the access key. Also indicate which is the internet (WAN) port and which is your local network (LAN); in most installations they are "wan" and "lan". On saving, you will see the device inventory.',
    },
  ],
  fields: [
    {
      key: 'baseUrl',
      label: 'pfSense address',
      help: 'Your pfSense’s web address, with https://. For example https://192.168.1.1.',
      type: 'url',
      placeholder: 'https://192.168.1.1',
      required: true,
    },
    {
      key: 'apiKey',
      label: 'Access key (API key)',
      help: 'The key you generated in the pfSense API configuration. It is stored encrypted and never shown again.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'wanInterface',
      label: 'Internet interface (WAN)',
      help: 'The name of the interface through which internet comes in. On pfSense it is usually "wan".',
      type: 'text',
      placeholder: 'wan',
      required: false,
      defaultValue: 'wan',
    },
    {
      key: 'lanInterface',
      label: 'Local network interface (LAN)',
      help: 'The name of your internal network interface. On pfSense it is usually "lan".',
      type: 'text',
      placeholder: 'lan',
      required: false,
      defaultValue: 'lan',
    },
  ],
  troubleshooting: [
    {
      q: 'The connection is rejected.',
      a: 'Check that the API package is installed and enabled, that the address includes https:// and that the access key is correct and has not expired.',
    },
    {
      q: 'Can I manage WiFi from here?',
      a: 'No. pfSense is a router-firewall, not a WiFi access point. Your WiFi access points are managed on their own; this integration covers inventory and blocking.',
    },
  ],
};

const ciscoIos: IntegrationGuide = {
  id: 'cisco-ios',
  domain: 'driver',
  kind: 'cisco-ios',
  category: 'router',
  displayName: 'Cisco IOS',
  vendor: 'Cisco (Catalyst)',
  icon: 'Network',
  tier: 4,
  wifiSupported: false,
  intro:
    'If you have a Cisco switch or router from the Catalyst family (2960, 3560, 9000, etc.) with the classic IOS system, KrakenOS can connect to it over SSH to see the connected devices and block the ones you want. It is an option for professional gear; it requires preparing the switch with a few commands. Cisco switches have no WiFi, so that part does not apply.',
  prerequisites: [
    'A Cisco switch or router with IOS and SSH enabled.',
    'A user with permissions to query and, if you are going to block, to enter configuration mode.',
    'The KrakenOS server being able to reach the device over SSH (normally port 22).',
    'This does not work for Cisco Meraki (managed only via cloud) nor for the Small Business range (no IOS).',
  ],
  steps: [
    {
      title: 'Enable SSH on the switch',
      body: 'From the device’s console, enter configuration mode and enable SSH by creating an admin user and the keys. The block of commands below does exactly that; change "TU_PASSWORD" for a secure password and save at the end.',
      command:
        'enable\nconfigure terminal\n hostname SW1\n ip domain-name casa.local\n crypto key generate rsa modulus 2048\n username admin privilege 15 secret TU_PASSWORD\n line vty 0 4\n  transport input ssh\n  login local\n ip ssh version 2\nend\nwrite memory',
      external: true,
    },
    {
      title: '"enable" password (if you use one)',
      body: 'Some devices ask for a second password to switch to admin mode (the "enable" mode). If your switch has one, keep it handy: you will enter it in the corresponding field below.',
      external: true,
    },
    {
      title: 'Connect KrakenOS',
      body: 'Enter the switch’s address, the SSH username and password, and if needed the "enable" password. Indicate the interface you want to measure traffic on (for example GigabitEthernet0/0). On saving, the inventory fills up with the devices the switch sees.',
    },
  ],
  fields: [
    {
      key: 'host',
      label: 'Switch address',
      help: 'The IP address of the Cisco switch or router on your network.',
      type: 'host',
      placeholder: '192.168.1.254',
      required: true,
    },
    {
      key: 'sshPort',
      label: 'SSH port',
      help: 'The door KrakenOS connects through over SSH. Normally 22.',
      type: 'number',
      required: false,
      defaultValue: 22,
    },
    {
      key: 'username',
      label: 'Username',
      help: 'The admin user you created for SSH.',
      type: 'text',
      placeholder: 'admin',
      required: true,
    },
    {
      key: 'password',
      label: 'Password',
      help: 'The password of that SSH user. It is stored encrypted.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'enablePassword',
      label: '"enable" password (optional)',
      help: 'Only if your device asks for a second password for admin mode. If you do not use one, leave it empty.',
      type: 'password',
      required: false,
      secret: true,
    },
    {
      key: 'interface',
      label: 'Traffic interface',
      help: 'The name of the interface you want to measure traffic on, for example GigabitEthernet0/0.',
      type: 'text',
      placeholder: 'GigabitEthernet0/0',
      required: true,
    },
    {
      key: 'vlan',
      label: 'Blocking VLAN',
      help: 'The VLAN where device blocks are applied. If you do not use VLANs, leave it at 1.',
      type: 'text',
      placeholder: '1',
      required: false,
      defaultValue: '1',
    },
  ],
  troubleshooting: [
    {
      q: 'It will not connect over SSH.',
      a: 'Verify that SSH is enabled (ip ssh version 2), that the username and password are correct and that the KrakenOS server can reach the switch on the indicated port.',
    },
    {
      q: 'I cannot block devices.',
      a: 'Blocking requires the user to be able to enter configuration mode. If your device asks for an "enable" password, make sure you have set it.',
    },
    {
      q: 'What if I have modern IOS-XE?',
      a: 'If your device is IOS-XE 16.6 or higher, consider the "Cisco NETCONF" option, which is cleaner and more robust. For classic IOS or older gear, this is the right one.',
    },
  ],
};

const ciscoNetconf: IntegrationGuide = {
  id: 'cisco-netconf',
  domain: 'driver',
  kind: 'cisco-netconf',
  category: 'router',
  displayName: 'Cisco NETCONF',
  vendor: 'Cisco (IOS-XE 16.6+)',
  icon: 'Network',
  tier: 4,
  wifiSupported: false,
  intro:
    'This is the modern way to manage Cisco devices running IOS-XE 16.6 or higher. Instead of "reading the screen" of the device, KrakenOS talks to it in a structured format (NETCONF), which makes changes more reliable and orderly. You will be able to see the devices and block them. Just like the other Cisco option, WiFi does not apply.',
  prerequisites: [
    'A Cisco device with IOS-XE 16.6 or higher.',
    'NETCONF enabled on the device (listening on port 830).',
    'A user with permissions to query and modify the configuration.',
  ],
  steps: [
    {
      title: 'Enable NETCONF on the device',
      body: 'Enter configuration mode and enable NETCONF with the "netconf-yang" command, create an admin user and save. The block below does it; change "TU_PASSWORD" for a secure password.',
      command:
        'configure terminal\n netconf-yang\n username admin privilege 15 secret TU_PASSWORD\nend\nwrite memory',
      external: true,
    },
    {
      title: 'Connect KrakenOS',
      body: 'Enter the device’s address, the NETCONF port (830 by default), the username and password, and the interface to measure traffic on. On saving, the inventory fills up with what the device sees.',
    },
  ],
  fields: [
    {
      key: 'host',
      label: 'Device address',
      help: 'The IP address of the Cisco device on your network.',
      type: 'host',
      placeholder: '192.168.1.254',
      required: true,
    },
    {
      key: 'port',
      label: 'NETCONF port',
      help: 'The door NETCONF responds on. By default it is 830.',
      type: 'number',
      required: false,
      defaultValue: 830,
    },
    {
      key: 'username',
      label: 'Username',
      help: 'The admin user you created.',
      type: 'text',
      placeholder: 'admin',
      required: true,
    },
    {
      key: 'password',
      label: 'Password',
      help: 'The password of that user. It is stored encrypted.',
      type: 'password',
      required: true,
      secret: true,
    },
    {
      key: 'interface',
      label: 'Traffic interface',
      help: 'The name of the interface to measure traffic on, for example GigabitEthernet1.',
      type: 'text',
      placeholder: 'GigabitEthernet1',
      required: true,
    },
  ],
  troubleshooting: [
    {
      q: 'It does not respond on port 830.',
      a: 'Confirm that you ran "netconf-yang" and saved the configuration, and that the device is IOS-XE 16.6 or higher. You can verify it from the server by attempting a NETCONF connection.',
    },
    {
      q: 'When should I use this option and not "Cisco IOS"?',
      a: 'Use NETCONF only if your device is IOS-XE 16.6 or newer: it is more robust. For classic IOS or older gear, use the "Cisco IOS" option.',
    },
  ],
};

const mock: IntegrationGuide = {
  id: 'mock',
  domain: 'driver',
  kind: 'mock',
  category: 'router',
  displayName: 'Demo mode',
  icon: 'FlaskConical',
  tier: 1,
  wifiSupported: true,
  intro:
    'Demo mode simulates a home full of devices, WiFi networks and traffic, without needing any real hardware. It is perfect for exploring KrakenOS at your leisure, learning where everything is and trying out the buttons (block, change WiFi, etc.) without fear of breaking anything. When you are ready to control your real network, choose your router’s driver.',
  prerequisites: ['Nothing. Demo mode works as is, with no data or devices.'],
  steps: [
    {
      title: 'Turn it on and explore',
      body: 'Demo mode does not ask for any configuration. When you turn it on, you will see a sample inventory with devices, simulated WiFi networks and traffic charts that move on their own. Everything is fictional and safe: you can touch anything.',
    },
    {
      title: 'When you are ready, connect your real router',
      body: 'When you feel comfortable, go back to the wizard and choose your router model (OpenWrt, ASUS, UniFi, Omada, MikroTik...). From then on, KrakenOS will show and manage your real network instead of the simulated one.',
    },
  ],
  fields: [],
  troubleshooting: [
    {
      q: 'Are the devices I see real?',
      a: 'No. In demo mode everything is simulated so you can explore. To see your real devices, connect your router’s driver.',
    },
    {
      q: 'Can I do any harm trying things out here?',
      a: 'Not at all. Nothing you do in demo mode affects your real network, because there is none connected.',
    },
  ],
};

export const DRIVER_GUIDES_EN: IntegrationGuide[] = [
  openwrt,
  asus,
  unifi,
  omada,
  mikrotik,
  pfsense,
  ciscoIos,
  ciscoNetconf,
  mock,
];
