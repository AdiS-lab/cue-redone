import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { NetworkLine } from './NetworkLine';
import { probe } from './probe';
import { useRingButton } from './useRingButton';

// This phone stands in for the Qu ring (ESP32-CAM, firmware/qu-ring): its camera is the ring's camera and one big
// button gives click (look), double (more) and hold (ask). It speaks the same protocol to the hub's /phone endpoint
// (see ../../src/vision/README.md "Wi-Fi (WebSocket)"):
//   phone -> hub: JPEG binaries, {"type":"burst-end"}, {"type":"button","action":"click|double|hold"}
//   hub -> phone: {"type":"capture","count":n}, {"type":"feedback","kind":"..."}

type Link = 'idle' | 'connecting' | 'live' | 'retrying';
type Action = 'click' | 'double' | 'hold';

const BLUE = '#2D5BD6';

const BUZZ: Record<string, () => Promise<void>> = {
  'on-target': () => Haptics.selectionAsync(),
  captured: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  highlight: () => Haptics.selectionAsync(),
  select: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};

export default function App() {
  const [url, setUrl] = useState('ws://192.168.1.10:8787/phone');
  const [active, setActive] = useState(false);
  const [link, setLink] = useState<Link>('idle');
  const [last, setLast] = useState('');

  // Remember what was typed: the app often has to be reopened (Wi-Fi changes), and retyping addresses is painful.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem('qu.connect.v1')
      .then((raw) => {
        if (!raw) return;
        const v = JSON.parse(raw) as { url?: string };
        if (v.url) setUrl(v.url);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    if (loaded) AsyncStorage.setItem('qu.connect.v1', JSON.stringify({ url })).catch(() => {});
  }, [loaded, url]);
  const [detail, setDetail] = useState(''); // why the link is down (close code / error)
  const [perm, askPerm] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const ws = useRef<WebSocket | null>(null);
  const shooting = useRef(false);

  // Sending on a socket that is not open throws InvalidStateError, so every send goes through here.
  const safeSend = useCallback((data: string | ArrayBuffer): boolean => {
    const s = ws.current;
    if (!s || s.readyState !== WebSocket.OPEN) return false;
    try {
      s.send(data);
      return true;
    } catch (e) {
      setDetail(`send failed: ${String(e)}`);
      return false;
    }
  }, []);

  const sendAction = useCallback((a: Action) => {
    if (!safeSend(JSON.stringify({ type: 'button', action: a }))) {
      setLast('not connected: nothing sent');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    setLast(`sent: ${a}`);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [safeSend]);

  const capture = useCallback(async (count: number) => {
    if (shooting.current || !cam.current) return;
    shooting.current = true;
    try {
      for (let i = 0; i < Math.max(1, Math.min(count, 5)); i++) {
        const p = await cam.current.takePictureAsync({ quality: 0.5 });
        const buf = await (await fetch(p.uri)).arrayBuffer();
        if (!safeSend(buf)) break;
      }
      safeSend(JSON.stringify({ type: 'burst-end' }));
    } catch (e) {
      console.warn('capture failed', e);
    } finally {
      shooting.current = false;
    }
  }, [safeSend]);

  useEffect(() => {
    if (!active) return;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let keepalive: ReturnType<typeof setInterval> | undefined;
    const open = () => {
      setLink((l) => (l === 'live' ? l : 'connecting'));
      const s = new WebSocket(url);
      s.binaryType = 'arraybuffer';
      ws.current = s;
      clearInterval(keepalive);
      keepalive = setInterval(() => safeSend(JSON.stringify({ type: 'ping' })), 15000);
      let opened = false;
      s.onopen = () => {
        opened = true;
        setLink('live');
        setDetail('');
      };
      s.onerror = (e) => setDetail(`error: ${(e as { message?: string }).message ?? 'connection failed'}`);
      s.onmessage = (e) => {
        if (typeof e.data !== 'string') return;
        try {
          const m = JSON.parse(e.data) as { type?: string; count?: number; kind?: string };
          if (m.type === 'capture') void capture(m.count ?? 1);
          else if (m.type === 'feedback' && m.kind) BUZZ[m.kind]?.().catch(() => {});
        } catch {
          // ignore non-JSON
        }
      };
      s.onclose = (e) => {
        clearInterval(keepalive);
        if (closed) return;
        const base = `closed: code ${e.code}${e.reason ? ` ${e.reason}` : ''}`;
        setDetail(base);
        if (!opened) void probe(url).then((r) => setDetail(`${base} | ${r}`));
        setLink('retrying');
        retry = setTimeout(open, 1500);
      };
    };
    open();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(keepalive);
      ws.current?.close();
      ws.current = null;
      setLink('idle');
    };
  }, [active, url, capture, safeSend]);

  const { onTap, onHold } = useRingButton(sendAction);

  if (!active) {
    return (
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: '#F5F2EC' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.pageScroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets>
        <StatusBar style="dark" />
        <Text style={s.title}>Qu ring</Text>
        <Text style={s.body}>
          This phone is the ring: its camera sees what you point at, and one big button looks (tap), tells you more
          (double tap) or asks a question (hold). Run <Text style={s.mono}>npm run hub</Text> on the laptop and enter
          the phone address it prints.
        </Text>
        <NetworkLine />
        <Text style={s.label}>Hub address</Text>
        <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="done" onSubmitEditing={Keyboard.dismiss} selectTextOnFocus style={s.input} accessibilityLabel="Hub address" />
        <Pressable style={s.primary} onPress={() => setActive(true)}>
          <Text style={s.primaryText}>Connect</Text>
        </Pressable>
      </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  if (!perm?.granted) {
    return (
      <View style={s.page}>
        <Text style={s.title}>Allow the camera</Text>
        <Pressable style={s.primary} onPress={askPerm}>
          <Text style={s.primaryText}>Allow camera</Text>
        </Pressable>
      </View>
    );
  }

  const dot = link === 'live' ? '#2F8A4A' : link === 'idle' ? '#8A8F99' : '#E0A200';
  return (
    <View style={s.cam}>
      <StatusBar style="light" />
      <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="back" />
      <View style={s.top}>
        <View style={s.pill}>
          <View style={[s.dot, { backgroundColor: dot }]} />
          <Text style={s.pillText}>{link === 'live' ? 'Connected' : link === 'retrying' ? 'Reconnecting…' : 'Connecting…'}</Text>
        </View>
        <Pressable style={s.pill} onPress={() => setActive(false)}>
          <Text style={s.pillText}>Change</Text>
        </Pressable>
      </View>
      <View style={s.reticle} pointerEvents="none" />
      <View style={s.bottom}>
        <Text style={s.hint}>tap: look · double tap: more · hold: ask</Text>
        <Pressable
          onPress={onTap}
          onLongPress={onHold}
          delayLongPress={500}
          accessibilityRole="button"
          accessibilityLabel="Ring button"
          style={({ pressed }) => [s.ring, pressed && { transform: [{ scale: 0.94 }] }]}
        >
          <View style={s.ringInner} />
        </Pressable>
        <Text style={s.last}>{last || ' '}</Text>
        {link !== 'live' && detail ? <Text style={s.detail}>{detail}</Text> : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  pageScroll: { flexGrow: 1, backgroundColor: '#F5F2EC', padding: 28, paddingTop: 72, justifyContent: 'center', gap: 18 },
  page: { flex: 1, backgroundColor: '#F5F2EC', padding: 28, justifyContent: 'center', gap: 18 },
  title: { fontSize: 32, fontWeight: '800', color: '#15171C' },
  body: { fontSize: 17, lineHeight: 24, color: '#4A505B' },
  mono: { fontFamily: 'Menlo', fontSize: 15 },
  input: { height: 60, borderRadius: 18, borderWidth: 1.5, borderColor: '#D6CFC2', backgroundColor: '#fff', paddingHorizontal: 16, fontSize: 17 },
  primary: { height: 64, borderRadius: 20, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 20, fontWeight: '700', color: '#fff' },
  label: { fontSize: 13, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: '#5B616D', marginBottom: -10 },
  cam: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', top: 60, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: 'rgba(0,0,0,.55)' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  pillText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  reticle: { position: 'absolute', alignSelf: 'center', top: '36%', width: 180, height: 180, borderRadius: 32, borderWidth: 3, borderColor: 'rgba(255,255,255,.85)' },
  bottom: { position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center', gap: 14 },
  hint: { color: '#fff', fontSize: 14, textAlign: 'center', paddingHorizontal: 24, textShadowColor: '#000', textShadowRadius: 4 },
  ring: { width: 104, height: 104, borderRadius: 52, borderWidth: 6, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  ringInner: { width: 74, height: 74, borderRadius: 37, backgroundColor: '#fff' },
  last: { color: '#C5C9D2', fontSize: 14 },
  detail: { color: '#FFD27A', fontSize: 13, textAlign: 'center', paddingHorizontal: 24 },
});
