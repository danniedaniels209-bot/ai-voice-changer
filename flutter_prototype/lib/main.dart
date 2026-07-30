// Voiceover Studio — Flutter Web UI prototype.
//
// This is a DESIGN PROTOTYPE, built to answer one question: do you actually
// prefer how Flutter looks and feels for this app? It is not connected to the
// backend and does not read or write any project.
//
// It is deliberately dependency-free — nothing but the Flutter SDK — so the
// Colab build cannot fail on a package resolution problem. All artwork
// (the neon stage, waveforms, filmstrips) is painted in code rather than
// shipped as assets, for the same reason.
//
// Known limitation worth remembering before anyone proposes going further:
// Flutter Web renders into a single <canvas>. The real app's export pipeline
// drives a headless browser, calls window.__setRenderTime(ms), and waits on a
// [data-render-time] DOM selector before screenshotting each frame — and it
// seeks real <video> elements by their data-* attributes. None of that exists
// in a Flutter canvas, so adopting Flutter for the actual app means redesigning
// the entire export architecture, not just the UI.

import 'dart:math' as math;
import 'package:flutter/material.dart';

void main() => runApp(const VoiceoverStudioApp());

/// Design tokens, matching the agreed palette.
class T {
  static const bg = Color(0xFF111111);
  static const surface2 = Color(0xFF1A1A1A);
  static const panel = Color(0xFF202020);
  static const border = Color(0x0FFFFFFF);
  static const borderStrong = Color(0x1AFFFFFF);
  static const accent = Color(0xFF00D2FF);
  static const accent2 = Color(0xFF7A5CFF);
  static const text = Color(0xFFEDEDED);
  static const muted = Color(0xFF9A9A9A);
  static const faint = Color(0xFF6B6B6B);
  static const field = Color(0xFF181818);
}

class VoiceoverStudioApp extends StatelessWidget {
  const VoiceoverStudioApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Voiceover Studio',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        scaffoldBackgroundColor: T.bg,
        fontFamily: 'Roboto',
        textTheme: const TextTheme(
          bodyMedium: TextStyle(fontSize: 13, color: T.text, fontWeight: FontWeight.w500),
        ),
      ),
      home: const StudioShell(),
    );
  }
}

class StudioShell extends StatefulWidget {
  const StudioShell({super.key});
  @override
  State<StudioShell> createState() => _StudioShellState();
}

class _StudioShellState extends State<StudioShell> with SingleTickerProviderStateMixin {
  String rail = 'Media';
  String mediaTab = 'Import';
  String inspTab = 'Video';
  String subTab = 'Basic';
  String voTab = 'Text to Speech';
  String selectedClip = 'video';

  double scale = 100;
  double opacity = 100;
  double pitch = 0;
  double speed = 1.0;
  double intensity = 0.8;
  bool uniform = true;
  bool blend = true;
  bool stabilize = false;
  bool showHint = true;

  static const int durationMs = 45000;
  late AnimationController _clock;
  bool playing = false;
  double playhead = 7500;

  @override
  void initState() {
    super.initState();
    // A real transport, so the timeline can be judged in motion. A still
    // image can't tell you whether the playhead reads at a glance.
    _clock = AnimationController(vsync: this, duration: const Duration(milliseconds: durationMs))
      ..addListener(() {
        if (playing) setState(() => playhead = _clock.value * durationMs);
      });
  }

  @override
  void dispose() {
    _clock.dispose();
    super.dispose();
  }

  void _togglePlay() {
    setState(() {
      playing = !playing;
      if (playing) {
        _clock.value = playhead / durationMs;
        _clock.repeat();
      } else {
        _clock.stop();
      }
    });
  }

  String _tc(double ms) {
    final t = ms.clamp(0, durationMs.toDouble());
    final m = (t / 60000).floor();
    final s = ((t % 60000) / 1000).floor();
    final f = ((t % 1000) / 40).floor();
    String p(int n) => n.toString().padLeft(2, '0');
    return '00:${p(m)}:${p(s)}:${p(f)}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          Column(
            children: [
              _topBar(),
              Expanded(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _rail(),
                    // Centre column: media + player above, timeline below.
                    Expanded(
                      child: Column(
                        children: [
                          Expanded(
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [_mediaPanel(), Expanded(child: _player())],
                            ),
                          ),
                          _timeline(),
                        ],
                      ),
                    ),
                    // Right column is FULL height — inspector above, voiceover
                    // below — which is why the timeline does not span the
                    // whole window.
                    _rightColumn(),
                  ],
                ),
              ),
            ],
          ),
          if (showHint) _hint(),
        ],
      ),
    );
  }

  // ─────────────────────────── Top bar ───────────────────────────
  Widget _topBar() {
    return Container(
      height: 52,
      color: T.surface2,
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              for (final h in const [7.0, 13.0, 17.0, 11.0, 6.0])
                Container(
                  width: 2.5,
                  height: h,
                  margin: const EdgeInsets.only(right: 2),
                  decoration: BoxDecoration(
                    color: (h == 13.0 || h == 11.0) ? T.accent2 : T.accent,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
            ],
          ),
          const SizedBox(width: 9),
          const Text('Voiceover Studio',
              style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: T.text)),
          const SizedBox(width: 14),
          _button('Menu', trailing: Icons.keyboard_arrow_down, onTap: () {}),
          const SizedBox(width: 14),
          const Icon(Icons.schedule, size: 14, color: T.muted),
          const SizedBox(width: 6),
          const Text('Auto saved: 10:30:15', style: TextStyle(fontSize: 12, color: T.muted)),
          Expanded(
            child: Center(
              child: const Text('New Project',
                  style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: T.text)),
            ),
          ),
          _iconButton(Icons.web_asset, () {}),
          const SizedBox(width: 8),
          _button('Shortcuts', leading: Icons.keyboard, onTap: () {}),
          const SizedBox(width: 8),
          _button('Join Pro',
              leading: Icons.star, bg: T.accent2, fg: Colors.white, onTap: () {}),
          const SizedBox(width: 8),
          _button('Export',
              leading: Icons.file_upload_outlined,
              bg: T.accent,
              fg: const Color(0xFF04222B),
              bold: true,
              onTap: () {}),
          const SizedBox(width: 10),
          _winBtn(Icons.remove),
          _winBtn(Icons.crop_square),
          _winBtn(Icons.close, danger: true),
        ],
      ),
    );
  }

  Widget _winBtn(IconData i, {bool danger = false}) => _HoverBox(
        hoverColor: danger ? const Color(0xFFFF5C5C) : const Color(0x14FFFFFF),
        borderRadius: 6,
        child: SizedBox(width: 34, height: 30, child: Icon(i, size: 14, color: T.muted)),
      );

  Widget _button(String label,
      {IconData? leading,
      IconData? trailing,
      Color? bg,
      Color? fg,
      bool bold = false,
      VoidCallback? onTap}) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 30,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: BoxDecoration(
          color: bg ?? const Color(0xFF242424),
          borderRadius: BorderRadius.circular(7),
          border: bg == null ? Border.all(color: T.borderStrong) : null,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (leading != null) ...[Icon(leading, size: 14, color: fg ?? T.text), const SizedBox(width: 7)],
            Text(label,
                style: TextStyle(
                    fontSize: 12.5,
                    color: fg ?? T.text,
                    fontWeight: bold ? FontWeight.w700 : FontWeight.w500)),
            if (trailing != null) ...[const SizedBox(width: 6), Icon(trailing, size: 14, color: fg ?? T.text)],
          ],
        ),
      ),
    );
  }

  Widget _iconButton(IconData i, VoidCallback onTap) => GestureDetector(
        onTap: onTap,
        child: _HoverBox(
          borderRadius: 6,
          child: SizedBox(width: 34, height: 30, child: Icon(i, size: 16, color: T.muted)),
        ),
      );

  // ─────────────────────────── Left rail ───────────────────────────
  Widget _rail() {
    const items = <String, IconData>{
      'Media': Icons.perm_media_outlined,
      'Audio': Icons.graphic_eq,
      'Text': Icons.title,
      'Stickers': Icons.emoji_emotions_outlined,
      'Effects': Icons.auto_awesome_outlined,
      'Transitions': Icons.compare_arrows,
      'Filters': Icons.filter_b_and_w,
      'Adjustment': Icons.tune,
      'Templates': Icons.dashboard_outlined,
    };
    return Container(
      width: 76,
      color: T.surface2,
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: SingleChildScrollView(
        child: Column(
          children: items.entries.map((e) {
            final on = rail == e.key;
            return GestureDetector(
              onTap: () => setState(() => rail = e.key),
              child: Container(
                margin: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                padding: const EdgeInsets.symmetric(vertical: 9),
                decoration: BoxDecoration(
                  color: on ? T.accent.withValues(alpha: 0.12) : Colors.transparent,
                  borderRadius: BorderRadius.circular(7),
                ),
                child: Column(
                  children: [
                    Icon(e.value, size: 19, color: on ? T.accent : T.faint),
                    const SizedBox(height: 5),
                    Text(e.key,
                        style: TextStyle(fontSize: 10.5, color: on ? T.accent : T.faint)),
                  ],
                ),
              ),
            );
          }).toList(),
        ),
      ),
    );
  }

  // ─────────────────────────── Media panel ───────────────────────────
  Widget _mediaPanel() {
    return Container(
      width: 490,
      color: T.panel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _panelHead(['Import', 'Record', 'Library'], mediaTab, (v) => setState(() => mediaTab = v)),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
            child: Row(
              children: [
                Container(
                  height: 30,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    color: const Color(0xFF0E2E38),
                    borderRadius: BorderRadius.circular(7),
                    border: Border.all(color: T.accent.withValues(alpha: 0.35)),
                  ),
                  child: Row(mainAxisSize: MainAxisSize.min, children: const [
                    CircleAvatar(radius: 3.5, backgroundColor: T.accent),
                    SizedBox(width: 7),
                    Text('Import',
                        style: TextStyle(fontSize: 12.5, color: T.accent, fontWeight: FontWeight.w600)),
                  ]),
                ),
                const Spacer(),
                const Icon(Icons.grid_view, size: 15, color: T.muted),
                const SizedBox(width: 14),
                const Icon(Icons.filter_list, size: 15, color: T.muted),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 10),
            child: Row(children: [
              const Text('All', style: TextStyle(fontSize: 12, color: T.muted)),
              const Icon(Icons.keyboard_arrow_down, size: 15, color: T.muted),
              const SizedBox(width: 8),
              Expanded(
                child: Container(
                  height: 28,
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  decoration: BoxDecoration(
                    color: T.field,
                    borderRadius: BorderRadius.circular(7),
                    border: Border.all(color: T.border),
                  ),
                  child: Row(children: const [
                    Expanded(child: Text('Search assets', style: TextStyle(fontSize: 12, color: T.faint))),
                    Icon(Icons.search, size: 14, color: T.faint),
                  ]),
                ),
              ),
            ]),
          ),
          Expanded(
            child: GridView.count(
              padding: const EdgeInsets.fromLTRB(14, 2, 14, 14),
              crossAxisCount: 3,
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              childAspectRatio: 0.82,
              children: const [
                _Asset(kind: 'folder', name: 'Project assets', sub: '12 items'),
                _Asset(kind: 'neon', name: 'podcast_intro.mp4', dur: '00:18', added: true),
                _Asset(kind: 'mic', name: 'mic_closeup.jpg', dur: '00:39'),
                _Asset(kind: 'wave', name: 'voice_sample.wav', dur: '02:36', seed: 3, waveColor: Color(0xFFA98BFF)),
                _Asset(kind: 'wave', name: 'bg_music.mp3', dur: '03:21', added: true, seed: 7, waveColor: Color(0xFF4FA8FF)),
                _Asset(kind: 'wave', name: 'sound_effect.wav', dur: '00:03', seed: 11, waveColor: Color(0xFF4FA8FF)),
                _Asset(kind: 'scene', name: 'scene_01.mp4', dur: '00:07'),
                _Asset(kind: 'neon', name: 'overlay.png', dur: '00:04', added: true),
                _Asset(kind: 'logo', name: 'logo.png'),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _panelHead(List<String> tabs, String active, ValueChanged<String> onTap) {
    return Container(
      height: 42,
      padding: const EdgeInsets.symmetric(horizontal: 14),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: T.border)),
      ),
      child: Row(
        children: tabs.map((t) {
          final on = t == active;
          return GestureDetector(
            onTap: () => onTap(t),
            child: Container(
              margin: const EdgeInsets.only(right: 18),
              height: 42,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                border: Border(
                  bottom: BorderSide(color: on ? T.accent : Colors.transparent, width: 2),
                ),
              ),
              child: Text(t,
                  style: TextStyle(
                      fontSize: 12.5,
                      color: on ? T.accent : T.muted,
                      fontWeight: on ? FontWeight.w600 : FontWeight.w500)),
            ),
          );
        }).toList(),
      ),
    );
  }

  // ─────────────────────────── Player ───────────────────────────
  Widget _player() {
    return Container(
      color: T.panel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            height: 42,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: T.border))),
            child: Row(children: const [
              Text('Player', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
              Spacer(),
              Icon(Icons.more_horiz, size: 18, color: T.faint),
            ]),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: const _NeonStage(),
              ),
            ),
          ),
          Container(
            height: 46,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: const BoxDecoration(border: Border(top: BorderSide(color: T.border))),
            child: Row(children: [
              Text(_tc(playhead),
                  style: const TextStyle(fontSize: 12.5, color: T.accent, fontWeight: FontWeight.w600)),
              const SizedBox(width: 12),
              Text(_tc(durationMs.toDouble()),
                  style: const TextStyle(fontSize: 12.5, color: T.muted)),
              const Spacer(),
              GestureDetector(
                onTap: _togglePlay,
                child: _HoverBox(
                  borderRadius: 17,
                  child: SizedBox(
                    width: 34,
                    height: 34,
                    child: Icon(playing ? Icons.pause : Icons.play_arrow, size: 22, color: T.text),
                  ),
                ),
              ),
              const Spacer(),
              const Icon(Icons.fit_screen_outlined, size: 16, color: T.muted),
              const SizedBox(width: 10),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  border: Border.all(color: T.borderStrong),
                  borderRadius: BorderRadius.circular(5),
                ),
                child: const Text('16:9', style: TextStyle(fontSize: 11, color: T.muted)),
              ),
              const SizedBox(width: 10),
              const Icon(Icons.fullscreen, size: 18, color: T.muted),
            ]),
          ),
        ],
      ),
    );
  }

  // ─────────────────────────── Right column ───────────────────────────
  Widget _rightColumn() {
    return Container(
      width: 400,
      color: T.panel,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(child: _inspector()),
          _voiceover(),
        ],
      ),
    );
  }

  Widget _inspector() {
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _panelHead(const ['Video', 'Audio', 'Speed', 'Animation', 'Adjustment'], inspTab,
              (v) => setState(() => inspTab = v)),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
            child: Row(
              children: ['Basic', 'Cutout', 'Mask', 'Enhance'].map((t) {
                final on = t == subTab;
                return Expanded(
                  child: GestureDetector(
                    onTap: () => setState(() => subTab = t),
                    child: Container(
                      margin: const EdgeInsets.symmetric(horizontal: 2),
                      padding: const EdgeInsets.symmetric(vertical: 7),
                      decoration: BoxDecoration(
                        color: on ? const Color(0xFF2B2B2B) : Colors.transparent,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(t,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                              fontSize: 12,
                              color: on ? T.text : T.muted,
                              fontWeight: on ? FontWeight.w600 : FontWeight.w500)),
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
          _groupHeader('Transform'),
          _sliderRow('Scale', scale, 0, 200, (v) => setState(() => scale = v), '%'),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
            child: Row(children: [
              const SizedBox(width: 86, child: Text('Uniform scale', style: TextStyle(fontSize: 12, color: T.muted))),
              const Spacer(),
              GestureDetector(
                onTap: () => setState(() => uniform = !uniform),
                child: _Toggle(on: uniform),
              ),
            ]),
          ),
          _numberRow('Position', const ['X', 'Y'], const ['0', '0']),
          _numberRow('Rotate', const [''], const ['0.0°']),
          _alignRow(),
          const _Divider(),
          _groupHeader('Blend', check: blend, onCheck: () => setState(() => blend = !blend)),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
            child: Row(children: [
              const SizedBox(width: 86, child: Text('Mode', style: TextStyle(fontSize: 12, color: T.muted))),
              Expanded(
                child: Container(
                  height: 28,
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  decoration: BoxDecoration(
                    color: T.field,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: T.border),
                  ),
                  child: Row(children: const [
                    Text('Normal', style: TextStyle(fontSize: 12)),
                    Spacer(),
                    Icon(Icons.keyboard_arrow_down, size: 15, color: T.faint),
                  ]),
                ),
              ),
            ]),
          ),
          _sliderRow('Opacity', opacity, 0, 100, (v) => setState(() => opacity = v), '%'),
          const _Divider(),
          _groupHeader('Stabilize', check: stabilize, onCheck: () => setState(() => stabilize = !stabilize)),
          const SizedBox(height: 12),
        ],
      ),
    );
  }

  Widget _groupHeader(String label, {bool? check, VoidCallback? onCheck}) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
      child: Row(children: [
        if (check != null) ...[
          GestureDetector(
            onTap: onCheck,
            child: Container(
              width: 14,
              height: 14,
              decoration: BoxDecoration(
                color: check ? T.accent : Colors.transparent,
                border: Border.all(color: check ? T.accent : const Color(0xFF4A4A4A), width: 1.5),
                borderRadius: BorderRadius.circular(4),
              ),
              child: check
                  ? const Icon(Icons.check, size: 10, color: Color(0xFF04222B))
                  : null,
            ),
          ),
          const SizedBox(width: 8),
        ],
        Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
        const SizedBox(width: 6),
        const Icon(Icons.keyboard_arrow_down, size: 15, color: T.text),
        const Spacer(),
        const Icon(Icons.refresh, size: 14, color: T.faint),
      ]),
    );
  }

  Widget _sliderRow(String label, double value, double min, double max,
      ValueChanged<double> onChanged, String suffix) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
      child: Row(children: [
        SizedBox(width: 86, child: Text(label, style: const TextStyle(fontSize: 12, color: T.muted))),
        Expanded(
          child: SliderTheme(
            data: SliderThemeData(
              trackHeight: 3,
              activeTrackColor: T.accent,
              inactiveTrackColor: const Color(0xFF3A3A3A),
              thumbColor: Colors.white,
              overlayShape: SliderComponentShape.noOverlay,
              thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
            ),
            child: Slider(value: value.clamp(min, max), min: min, max: max, onChanged: onChanged),
          ),
        ),
        const SizedBox(width: 8),
        _Stepper(text: '${value.round()}$suffix'),
      ]),
    );
  }

  Widget _numberRow(String label, List<String> keys, List<String> values) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
      child: Row(children: [
        SizedBox(width: 86, child: Text(label, style: const TextStyle(fontSize: 12, color: T.muted))),
        for (var i = 0; i < keys.length; i++) ...[
          if (keys[i].isNotEmpty) ...[
            Text(keys[i], style: const TextStyle(fontSize: 11.5, color: T.faint)),
            const SizedBox(width: 6),
          ],
          _Stepper(text: values[i]),
          const SizedBox(width: 10),
        ],
        const Spacer(),
        const Icon(Icons.change_history, size: 13, color: T.faint),
      ]),
    );
  }

  Widget _alignRow() {
    const icons = [
      Icons.align_horizontal_left, Icons.align_horizontal_center, Icons.align_horizontal_right,
      Icons.align_vertical_top, Icons.align_vertical_center, Icons.align_vertical_bottom,
      Icons.horizontal_distribute, Icons.vertical_distribute,
    ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 0, 14, 6),
      child: Row(
        children: List.generate(icons.length, (i) {
          // Distribute needs 3+ objects selected; only one clip is selected
          // in this state, so the last two are correctly disabled.
          final off = i >= 6;
          return Expanded(
            child: Container(
              height: 28,
              alignment: Alignment.center,
              child: Icon(icons[i], size: 15, color: off ? const Color(0xFF3E3E3E) : T.muted),
            ),
          );
        }),
      ),
    );
  }

  // ─────────────────────────── Voiceover AI ───────────────────────────
  Widget _voiceover() {
    return Container(
      height: 452,
      decoration: const BoxDecoration(border: Border(top: BorderSide(color: T.border))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Padding(
            padding: EdgeInsets.fromLTRB(14, 12, 14, 8),
            child: Text('Voiceover AI', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: T.border))),
            child: Row(
              children: ['Text to Speech', 'Voice Changer', 'Speech to Text'].map((t) {
                final on = t == voTab;
                return GestureDetector(
                  onTap: () => setState(() => voTab = t),
                  child: Container(
                    margin: const EdgeInsets.only(right: 18),
                    padding: const EdgeInsets.only(bottom: 9),
                    decoration: BoxDecoration(
                      border: Border(bottom: BorderSide(color: on ? T.accent : Colors.transparent, width: 2)),
                    ),
                    child: Text(t,
                        style: TextStyle(
                            fontSize: 12.5,
                            color: on ? T.accent : T.muted,
                            fontWeight: on ? FontWeight.w600 : FontWeight.w500)),
                  ),
                );
              }).toList(),
            ),
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('Select Voice', style: TextStyle(fontSize: 12, color: T.muted)),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.all(11),
                    decoration: BoxDecoration(
                      color: T.field,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: T.border),
                    ),
                    child: Row(children: [
                      Container(
                        width: 42,
                        height: 42,
                        decoration: const BoxDecoration(
                          shape: BoxShape.circle,
                          gradient: LinearGradient(colors: [Color(0xFF5B7FB5), Color(0xFF33507A)]),
                        ),
                        child: const Icon(Icons.person, size: 24, color: Color(0xFFD8A98B)),
                      ),
                      const SizedBox(width: 11),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Alex (Natural)',
                              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 6),
                          Row(
                            children: ['Male', 'Young Adult', 'English'].map((c) {
                              return Container(
                                margin: const EdgeInsets.only(right: 5),
                                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                decoration: BoxDecoration(
                                  color: const Color(0xFF262626),
                                  borderRadius: BorderRadius.circular(5),
                                ),
                                child: Text(c, style: const TextStyle(fontSize: 10.5, color: T.muted)),
                              );
                            }).toList(),
                          ),
                        ],
                      ),
                      const Spacer(),
                      Container(
                        width: 28,
                        height: 28,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          border: Border.all(color: T.borderStrong),
                        ),
                        child: const Icon(Icons.play_arrow, size: 15, color: T.text),
                      ),
                    ]),
                  ),
                  const SizedBox(height: 18),
                  Row(children: const [
                    Text('Voice Settings', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                    SizedBox(width: 6),
                    Icon(Icons.keyboard_arrow_down, size: 15, color: T.text),
                  ]),
                  const SizedBox(height: 12),
                  _voSlider('Pitch', pitch, -10, 10, (v) => setState(() => pitch = v), 0),
                  _voSlider('Speed', speed, 0.5, 2.0, (v) => setState(() => speed = v), 1),
                  _voSlider('Intensity', intensity, 0, 1, (v) => setState(() => intensity = v), 1),
                  const SizedBox(height: 14),
                  SizedBox(
                    height: 38,
                    child: ElevatedButton(
                      onPressed: () {},
                      style: ElevatedButton.styleFrom(
                        backgroundColor: T.accent,
                        foregroundColor: const Color(0xFF04222B),
                        elevation: 0,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(7)),
                      ),
                      child: const Text('Generate Speech',
                          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _voSlider(String label, double value, double min, double max,
      ValueChanged<double> onChanged, int decimals) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontSize: 12, color: T.muted)),
        Row(children: [
          Expanded(
            child: SliderTheme(
              data: SliderThemeData(
                trackHeight: 3,
                activeTrackColor: T.accent,
                inactiveTrackColor: const Color(0xFF3A3A3A),
                thumbColor: Colors.white,
                overlayShape: SliderComponentShape.noOverlay,
                thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
              ),
              child: Slider(value: value.clamp(min, max), min: min, max: max, onChanged: onChanged),
            ),
          ),
          const SizedBox(width: 8),
          _Stepper(text: value.toStringAsFixed(decimals)),
        ]),
        const SizedBox(height: 8),
      ],
    );
  }

  // ─────────────────────────── Timeline ───────────────────────────
  Widget _timeline() {
    return Container(
      height: 300,
      decoration: const BoxDecoration(
        color: T.surface2,
        border: Border(top: BorderSide(color: T.border)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            height: 40,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: T.border))),
            child: Row(children: [
              for (final i in const [
                Icons.undo, Icons.redo, Icons.content_cut, Icons.first_page, Icons.last_page,
                Icons.delete_outline, Icons.crop, Icons.bookmark_border, Icons.warning_amber,
                Icons.link_off, Icons.image_outlined,
              ])
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: Icon(i, size: 17, color: T.muted),
                ),
              const Spacer(),
              const Icon(Icons.mic_none, size: 17, color: T.muted),
              const SizedBox(width: 12),
              const Icon(Icons.more_horiz, size: 17, color: T.muted),
            ]),
          ),
          Expanded(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(
                  width: 118,
                  decoration: const BoxDecoration(border: Border(right: BorderSide(color: T.border))),
                  child: Column(children: [
                    const SizedBox(height: 26 + 8 + 30 + 8),
                    _trackHead(Icons.videocam_outlined, 76),
                    _trackHead(Icons.mic_none, 54),
                    _trackHead(Icons.music_note_outlined, 54),
                  ]),
                ),
                Expanded(child: _lanes()),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _trackHead(IconData mid, double h) => SizedBox(
        height: h,
        child: Row(children: [
          const SizedBox(width: 10),
          const Icon(Icons.visibility_outlined, size: 14, color: T.faint),
          const SizedBox(width: 9),
          Icon(mid, size: 14, color: T.faint),
          const SizedBox(width: 9),
          const Icon(Icons.volume_up_outlined, size: 14, color: T.faint),
        ]),
      );

  Widget _lanes() {
    return LayoutBuilder(builder: (context, box) {
      final w = box.maxWidth;
      void scrub(double dx) =>
          setState(() => playhead = (dx / w * durationMs).clamp(0, durationMs.toDouble()));
      return GestureDetector(
        onTapDown: (d) => scrub(d.localPosition.dx),
        onHorizontalDragUpdate: (d) => scrub(d.localPosition.dx),
        child: Stack(children: [
          Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SizedBox(
              height: 26,
              child: Row(
                children: List.generate(10, (i) {
                  return Expanded(
                    child: Container(
                      alignment: Alignment.bottomLeft,
                      padding: const EdgeInsets.only(left: 5, bottom: 5),
                      decoration: const BoxDecoration(
                        border: Border(left: BorderSide(color: Color(0x0DFFFFFF))),
                      ),
                      child: Text('00:00:${(i * 5).toString().padLeft(2, '0')}',
                          style: const TextStyle(fontSize: 10, color: T.faint)),
                    ),
                  );
                }),
              ),
            ),
            const SizedBox(height: 8),
            _lane(30, _clip('text', 0.04, 0.38, const Color(0xFF8E6BFF), 'WELCOME TO VOICEOVER STUDIO')),
            const SizedBox(height: 8),
            _lane(76, _videoClip()),
            const SizedBox(height: 8),
            _lane(54, _audioClip('vo', 0.0, 0.92, const Color(0xFF10333D), const Color(0xFF4FE3D6), 'voice_sample.wav', 3, true)),
            const SizedBox(height: 8),
            _lane(54, _audioClip('music', 0.0, 0.88, const Color(0xFF16233F), const Color(0xFF5B9BFF), 'bg_music.mp3', 9, false)),
          ]),
          Positioned(
            left: (playhead / durationMs) * w,
            top: 0,
            bottom: 0,
            child: Container(
              width: 1.5,
              color: Colors.white,
              child: Align(
                alignment: Alignment.topCenter,
                child: Container(width: 11, height: 13, color: Colors.white),
              ),
            ),
          ),
        ]),
      );
    });
  }

  Widget _lane(double h, Widget child) => SizedBox(height: h, child: Stack(children: [child]));

  Widget _clip(String id, double left, double width, Color color, String label) {
    return LayoutBuilder(builder: (context, box) {
      final on = selectedClip == id;
      return Positioned(
        left: box.maxWidth * left,
        width: box.maxWidth * width,
        top: 0,
        bottom: 0,
        child: GestureDetector(
          onTap: () => setState(() => selectedClip = id),
          child: Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [color, color.withValues(alpha: 0.8)],
              ),
              borderRadius: BorderRadius.circular(7),
              border: Border.all(color: on ? T.accent : Colors.transparent),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 8),
            alignment: Alignment.topLeft,
            child: Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(label,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.white)),
            ),
          ),
        ),
      );
    });
  }

  Widget _videoClip() {
    return LayoutBuilder(builder: (context, box) {
      final on = selectedClip == 'video';
      return Stack(children: [
        Positioned(
          left: box.maxWidth * 0.04,
          width: box.maxWidth * 0.73,
          top: 0,
          bottom: 0,
          child: GestureDetector(
            onTap: () => setState(() => selectedClip = 'video'),
            child: Container(
              decoration: BoxDecoration(
                color: const Color(0xFF123039),
                borderRadius: BorderRadius.circular(7),
                border: Border.all(color: on ? T.accent : Colors.transparent),
              ),
              clipBehavior: Clip.antiAlias,
              child: Stack(children: [
                Row(
                  children: List.generate(9, (i) {
                    final shades = [
                      [const Color(0xFF3A1450), const Color(0xFF7A1A6A)],
                      [const Color(0xFF241040), const Color(0xFF4A1858)],
                      [const Color(0xFF1B1030), const Color(0xFF5A1550)],
                    ][i % 3];
                    return Expanded(
                      child: Container(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topLeft, end: Alignment.bottomRight, colors: shades),
                        ),
                      ),
                    );
                  }),
                ),
                const Padding(
                  padding: EdgeInsets.fromLTRB(8, 4, 8, 0),
                  child: Text('podcast_intro.mp4  00:00:18:15',
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.white)),
                ),
              ]),
            ),
          ),
        ),
        Positioned(
          left: box.maxWidth * 0.78,
          width: box.maxWidth * 0.20,
          top: 0,
          bottom: 0,
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(7),
              gradient: const RadialGradient(
                center: Alignment(-0.2, -0.2),
                radius: 0.9,
                colors: [Color(0xFF2A3A6A), Color(0xFF070B18)],
              ),
            ),
          ),
        ),
      ]);
    });
  }

  Widget _audioClip(String id, double left, double width, Color bg, Color wave,
      String label, int seed, bool keyframes) {
    return LayoutBuilder(builder: (context, box) {
      final on = selectedClip == id;
      return Positioned(
        left: box.maxWidth * left,
        width: box.maxWidth * width,
        top: 0,
        bottom: 0,
        child: GestureDetector(
          onTap: () => setState(() => selectedClip = id),
          child: Container(
            decoration: BoxDecoration(
              color: bg,
              borderRadius: BorderRadius.circular(7),
              border: Border.all(color: on ? T.accent : Colors.transparent),
            ),
            clipBehavior: Clip.antiAlias,
            child: Stack(children: [
              Positioned.fill(
                top: 22,
                child: CustomPaint(painter: _WavePainter(color: wave, seed: seed)),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
                child: Text(label,
                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.white)),
              ),
              if (keyframes)
                for (final p in const [0.18, 0.38, 0.52, 0.70, 0.88])
                  Positioned(
                    left: box.maxWidth * width * p,
                    top: 25,
                    child: Transform.rotate(
                      angle: math.pi / 4,
                      child: Container(width: 7, height: 7, color: Colors.white),
                    ),
                  ),
            ]),
          ),
        ),
      );
    });
  }

  Widget _hint() {
    return Positioned(
      top: 62,
      left: 0,
      right: 0,
      child: Center(
        child: GestureDetector(
          onTap: () => setState(() => showHint = false),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
            decoration: BoxDecoration(
              color: Colors.black.withValues(alpha: 0.86),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: T.borderStrong),
            ),
            child: const Text(
              'Flutter prototype · click the rail, tabs, sliders and timeline · not wired to the backend',
              style: TextStyle(fontSize: 11, color: T.muted),
            ),
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────── Small widgets ───────────────────────────

class _Divider extends StatelessWidget {
  const _Divider();
  @override
  Widget build(BuildContext context) =>
      Container(height: 1, margin: const EdgeInsets.symmetric(horizontal: 14, vertical: 8), color: T.border);
}

class _Toggle extends StatelessWidget {
  final bool on;
  const _Toggle({required this.on});
  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 150),
      width: 34,
      height: 19,
      decoration: BoxDecoration(
        color: on ? T.accent : const Color(0xFF3A3A3A),
        borderRadius: BorderRadius.circular(10),
      ),
      child: AnimatedAlign(
        duration: const Duration(milliseconds: 150),
        alignment: on ? Alignment.centerRight : Alignment.centerLeft,
        child: Container(
          margin: const EdgeInsets.all(2),
          width: 15,
          height: 15,
          decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
        ),
      ),
    );
  }
}

class _Stepper extends StatelessWidget {
  final String text;
  const _Stepper({required this.text});
  @override
  Widget build(BuildContext context) {
    return Container(
      height: 26,
      constraints: const BoxConstraints(minWidth: 74),
      padding: const EdgeInsets.only(left: 9, right: 6),
      decoration: BoxDecoration(
        color: T.field,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: T.border),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Text(text, style: const TextStyle(fontSize: 12)),
        const Spacer(),
        Column(mainAxisAlignment: MainAxisAlignment.center, children: const [
          Icon(Icons.arrow_drop_up, size: 12, color: T.faint),
          Icon(Icons.arrow_drop_down, size: 12, color: T.faint),
        ]),
      ]),
    );
  }
}

class _HoverBox extends StatefulWidget {
  final Widget child;
  final double borderRadius;
  final Color hoverColor;
  const _HoverBox({
    required this.child,
    this.borderRadius = 6,
    this.hoverColor = const Color(0x14FFFFFF),
  });
  @override
  State<_HoverBox> createState() => _HoverBoxState();
}

class _HoverBoxState extends State<_HoverBox> {
  bool over = false;
  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      onEnter: (_) => setState(() => over = true),
      onExit: (_) => setState(() => over = false),
      child: Container(
        decoration: BoxDecoration(
          color: over ? widget.hoverColor : Colors.transparent,
          borderRadius: BorderRadius.circular(widget.borderRadius),
        ),
        child: widget.child,
      ),
    );
  }
}

/// Painted rather than shipped as an image, so the prototype has no assets
/// and cannot fail to build over a missing file.
class _NeonStage extends StatelessWidget {
  const _NeonStage();
  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF1B0B33), Color(0xFF0A0616)],
        ),
      ),
      child: Stack(children: [
        const Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: RadialGradient(
                center: Alignment(-0.55, -0.1),
                radius: 0.9,
                colors: [Color(0x99782CC8), Color(0x00000000)],
              ),
            ),
          ),
        ),
        const Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: RadialGradient(
                center: Alignment(0.55, 0.1),
                radius: 0.85,
                colors: [Color(0xAAD21E8C), Color(0x00000000)],
              ),
            ),
          ),
        ),
        Align(
          alignment: const Alignment(-0.55, -0.15),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 12),
            decoration: BoxDecoration(
              border: Border.all(color: const Color(0xFFFF4FD8), width: 2.5),
              borderRadius: BorderRadius.circular(6),
              boxShadow: const [
                BoxShadow(color: Color(0x88FF4FD8), blurRadius: 22, spreadRadius: 1),
              ],
            ),
            child: const Text('ON AIR',
                style: TextStyle(
                    color: Color(0xFFFFD9F6),
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 2.2)),
          ),
        ),
        Align(
          alignment: const Alignment(0.45, 0),
          child: FractionallySizedBox(
            heightFactor: 0.82,
            widthFactor: 0.22,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(200),
                gradient: const LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Color(0xFF3A3F4A), Color(0xFF0B0D12)],
                ),
                boxShadow: const [BoxShadow(color: Color(0x99000000), blurRadius: 28)],
              ),
            ),
          ),
        ),
      ]),
    );
  }
}

/// Deterministic waveform, so the prototype looks identical on every load.
class _WavePainter extends CustomPainter {
  final Color color;
  final int seed;
  const _WavePainter({required this.color, required this.seed});

  @override
  void paint(Canvas canvas, Size size) {
    const bars = 150;
    var s = seed;
    double next() {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    }

    final paint = Paint()
      ..color = color.withValues(alpha: 0.92)
      ..strokeWidth = (size.width / bars) * 0.62
      ..strokeCap = StrokeCap.round;

    for (var i = 0; i < bars; i++) {
      final x = (i / bars) * size.width;
      // Envelope so it reads as speech/music rather than uniform noise.
      final env = 0.35 + 0.65 * (math.sin(i / bars * math.pi * 3.1 + seed)).abs();
      final a = math.max(2.0, (next() * 0.75 + 0.25) * env * size.height * 0.46);
      canvas.drawLine(Offset(x, size.height / 2 - a), Offset(x, size.height / 2 + a), paint);
    }
  }

  @override
  bool shouldRepaint(covariant _WavePainter old) => old.color != color || old.seed != seed;
}

class _Asset extends StatelessWidget {
  final String kind;
  final String name;
  final String? dur;
  final String? sub;
  final bool added;
  final int seed;
  final Color waveColor;
  const _Asset({
    required this.kind,
    required this.name,
    this.dur,
    this.sub,
    this.added = false,
    this.seed = 1,
    this.waveColor = const Color(0xFF4FA8FF),
  });

  @override
  Widget build(BuildContext context) {
    Widget inner;
    switch (kind) {
      case 'folder':
        inner = Center(
          child: FractionallySizedBox(
            widthFactor: 0.58,
            heightFactor: 0.55,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(6),
                  topRight: Radius.circular(10),
                  bottomLeft: Radius.circular(10),
                  bottomRight: Radius.circular(10),
                ),
                gradient: const LinearGradient(colors: [Color(0xFFF5C451), Color(0xFFE0A62F)]),
              ),
            ),
          ),
        );
        break;
      case 'neon':
        inner = const _NeonStage();
        break;
      case 'wave':
        inner = CustomPaint(painter: _WavePainter(color: waveColor, seed: seed));
        break;
      case 'logo':
        inner = const Center(
          child: Text('S',
              style: TextStyle(fontSize: 34, fontWeight: FontWeight.w800, color: Color(0xFFDDDDDD))),
        );
        break;
      case 'scene':
        inner = Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFF2B1140), Color(0xFF5A1150), Color(0xFF101020)],
            ),
          ),
        );
        break;
      default:
        inner = Container(
          decoration: const BoxDecoration(
            gradient: RadialGradient(colors: [Color(0xFF4A4F5A), Color(0xFF14171D)]),
          ),
        );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Container(
            decoration: BoxDecoration(
              color: const Color(0xFF151515),
              borderRadius: BorderRadius.circular(7),
              border: Border.all(color: T.border),
            ),
            clipBehavior: Clip.antiAlias,
            child: Stack(children: [
              Positioned.fill(child: inner),
              if (added)
                Positioned(
                  left: 6,
                  top: 6,
                  child: _tag('Added'),
                ),
              if (dur != null) Positioned(right: 6, top: 6, child: _tag(dur!)),
            ]),
          ),
        ),
        const SizedBox(height: 7),
        Text(name,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 11.5, color: T.muted)),
        if (sub != null)
          Text(sub!, style: const TextStyle(fontSize: 10.5, color: T.faint)),
      ],
    );
  }

  Widget _tag(String s) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.72),
          borderRadius: BorderRadius.circular(5),
        ),
        child: Text(s, style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: Colors.white)),
      );
}
