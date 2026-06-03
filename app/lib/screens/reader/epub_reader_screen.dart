import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_epub_viewer/flutter_epub_viewer.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../providers/server_provider.dart';
import '../../theme.dart';

/// EPUB reader built on flutter_epub_viewer (epub.js in a webview). Uses CFI
/// locators, which match what the web reader and server already store — so
/// progress resumes across devices.
class EpubReaderScreen extends ConsumerStatefulWidget {
  final int bookId;
  final String format;

  const EpubReaderScreen({
    super.key,
    required this.bookId,
    required this.format,
  });

  @override
  ConsumerState<EpubReaderScreen> createState() => _EpubReaderScreenState();
}

class _EpubReaderScreenState extends ConsumerState<EpubReaderScreen> {
  final EpubController _epubController = EpubController();

  bool _loading = true;
  String? _error;
  double _downloadProgress = 0;

  File? _bookFile;
  String? _savedCfi;
  double _progress = 0;
  bool _chromeVisible = true;
  List<EpubChapter> _chapters = const [];

  // Reader preferences (persisted locally).
  double _fontSize = 16;
  String _themeName = 'dark'; // dark | light | sepia
  bool _scrolled = false; // false = paginated, true = continuous scroll

  Timer? _saveDebounce;

  static const _prefsFontKey = 'reader_epub_font_size';
  static const _prefsThemeKey = 'reader_epub_theme';
  static const _prefsFlowKey = 'reader_epub_scrolled';

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void dispose() {
    _saveDebounce?.cancel();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      _fontSize = prefs.getDouble(_prefsFontKey) ?? 16;
      _themeName = prefs.getString(_prefsThemeKey) ?? 'dark';
      _scrolled = prefs.getBool(_prefsFlowKey) ?? false;

      final api = ref.read(apiServiceProvider);

      // Restore saved position (CFI) for this format if any.
      try {
        final progressList = await api.getProgress(widget.bookId.toString());
        final match = progressList.where(
          (p) => p.format.toLowerCase() == widget.format.toLowerCase(),
        );
        if (match.isNotEmpty) {
          _savedCfi = match.first.locator;
          _progress = match.first.percent;
        }
      } catch (_) {
        // progress is best-effort
      }

      final file = await api.downloadBookFile(
        widget.bookId,
        widget.format,
        onProgress: (received, total) {
          if (total > 0 && mounted) {
            setState(() => _downloadProgress = received / total);
          }
        },
      );

      if (!mounted) return;
      setState(() {
        _bookFile = file;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Failed to open book: $e';
        _loading = false;
      });
    }
  }

  EpubTheme get _epubTheme {
    switch (_themeName) {
      case 'light':
        return EpubTheme.light();
      case 'sepia':
        return EpubTheme.custom(
          backgroundColor: const Color(0xFFF4ECD8),
          foregroundColor: const Color(0xFF5B4636),
        );
      case 'dark':
      default:
        return EpubTheme.dark();
    }
  }

  void _onRelocated(EpubLocation location) {
    _progress = location.progress;
    _savedCfi = location.startCfi;
    _saveDebounce?.cancel();
    _saveDebounce = Timer(const Duration(seconds: 2), _saveProgress);
    if (mounted) setState(() {});
  }

  Future<void> _saveProgress() async {
    final cfi = _savedCfi;
    if (cfi == null) return;
    try {
      await ref.read(apiServiceProvider).updateProgress(
            widget.bookId.toString(),
            format: widget.format.toUpperCase(),
            percent: _progress.clamp(0.0, 1.0),
            locator: cfi,
          );
    } catch (_) {
      // best-effort; will retry on next relocation
    }
  }

  Future<void> _addBookmark() async {
    final cfi = _savedCfi;
    if (cfi == null || cfi.isEmpty) return;
    try {
      await ref.read(apiServiceProvider).createBookmark(
            widget.bookId.toString(),
            locator: cfi,
          );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Bookmarked')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not save bookmark')),
        );
      }
    }
  }

  Future<void> _persistPrefs() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble(_prefsFontKey, _fontSize);
    await prefs.setString(_prefsThemeKey, _themeName);
    await prefs.setBool(_prefsFlowKey, _scrolled);
  }

  void _toggleFlow() {
    // Flow is applied from displaySettings when the viewer loads. Toggling
    // changes the viewer's key, which rebuilds it with the new flow; the saved
    // CFI is restored in onEpubLoaded.
    setState(() => _scrolled = !_scrolled);
    _persistPrefs();
  }

  void _turnPage(bool forward) {
    if (forward) {
      _epubController.next();
    } else {
      _epubController.prev();
    }
  }

  void _changeFont(double delta) {
    setState(() => _fontSize = (_fontSize + delta).clamp(10.0, 32.0));
    _epubController.setFontSize(fontSize: _fontSize);
    _persistPrefs();
  }

  void _cycleTheme() {
    setState(() {
      _themeName = switch (_themeName) {
        'dark' => 'light',
        'light' => 'sepia',
        _ => 'dark',
      };
    });
    _epubController.updateTheme(theme: _epubTheme);
    _persistPrefs();
  }

  void _openToc() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: IronshelfColors.surface,
      isScrollControlled: true,
      builder: (context) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.6,
        maxChildSize: 0.9,
        builder: (context, scrollController) => ListView(
          controller: scrollController,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Contents',
                  style:
                      TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            ),
            if (_chapters.isEmpty)
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text('No chapters available'),
              ),
            ..._chapters.map(
              (chapter) => ListTile(
                title: Text(chapter.title),
                onTap: () {
                  Navigator.pop(context);
                  _epubController.display(cfi: chapter.href);
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return Scaffold(
        backgroundColor: IronshelfColors.background,
        appBar: AppBar(),
        body: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(
                value: _downloadProgress > 0 ? _downloadProgress : null,
              ),
              const SizedBox(height: 16),
              Text(_downloadProgress > 0
                  ? 'Downloading ${(_downloadProgress * 100).round()}%'
                  : 'Loading book…'),
            ],
          ),
        ),
      );
    }

    if (_error != null || _bookFile == null) {
      return Scaffold(
        appBar: AppBar(),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(_error ?? 'Failed to open book',
                textAlign: TextAlign.center),
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: IronshelfColors.background,
      body: SafeArea(
        child: Stack(
          children: [
            EpubViewer(
              // Keyed by flow so toggling paginated/scroll rebuilds the viewer.
              key: ValueKey('epub-flow-$_scrolled'),
              epubSource: EpubSource.fromFile(_bookFile!),
              epubController: _epubController,
              displaySettings: EpubDisplaySettings(
                fontSize: _fontSize.round(),
                theme: _epubTheme,
                flow: _scrolled ? EpubFlow.scrolled : EpubFlow.paginated,
                useSnapAnimationAndroid: false,
              ),
              onEpubLoaded: () {
                if (_savedCfi != null && _savedCfi!.isNotEmpty) {
                  _epubController.display(cfi: _savedCfi!);
                }
              },
              onChaptersLoaded: (chapters) {
                if (mounted) setState(() => _chapters = chapters);
              },
              onRelocated: _onRelocated,
            ),
            // Tap zones: left = previous page, right = next page, center =
            // toggle the toolbar. In scroll mode the edges still page-jump.
            Positioned.fill(
              child: Row(
                children: [
                  Expanded(
                    child: GestureDetector(
                      behavior: HitTestBehavior.translucent,
                      onTap: () => _turnPage(false),
                    ),
                  ),
                  Expanded(
                    child: GestureDetector(
                      behavior: HitTestBehavior.translucent,
                      onTap: () =>
                          setState(() => _chromeVisible = !_chromeVisible),
                    ),
                  ),
                  Expanded(
                    child: GestureDetector(
                      behavior: HitTestBehavior.translucent,
                      onTap: () => _turnPage(true),
                    ),
                  ),
                ],
              ),
            ),
            if (_chromeVisible) _buildTopBar(),
            if (_chromeVisible) _buildBottomBar(),
          ],
        ),
      ),
    );
  }

  Widget _buildTopBar() {
    return Positioned(
      top: 0,
      left: 0,
      right: 0,
      child: Material(
        color: IronshelfColors.surface.withValues(alpha: 0.95),
        child: Row(
          children: [
            IconButton(
              icon: const Icon(Icons.arrow_back),
              onPressed: () {
                _saveProgress();
                Navigator.of(context).maybePop();
              },
            ),
            const Spacer(),
            IconButton(
              icon: const Icon(Icons.text_decrease),
              tooltip: 'Smaller text',
              onPressed: () => _changeFont(-1),
            ),
            IconButton(
              icon: const Icon(Icons.text_increase),
              tooltip: 'Larger text',
              onPressed: () => _changeFont(1),
            ),
            IconButton(
              icon: Icon(_scrolled ? Icons.menu_book : Icons.vertical_distribute),
              tooltip: _scrolled ? 'Paged' : 'Scroll',
              onPressed: _toggleFlow,
            ),
            IconButton(
              icon: const Icon(Icons.brightness_6),
              tooltip: 'Theme',
              onPressed: _cycleTheme,
            ),
            IconButton(
              icon: const Icon(Icons.bookmark_add_outlined),
              tooltip: 'Bookmark this spot',
              onPressed: _addBookmark,
            ),
            IconButton(
              icon: const Icon(Icons.list),
              tooltip: 'Contents',
              onPressed: _openToc,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBottomBar() {
    return Positioned(
      bottom: 0,
      left: 0,
      right: 0,
      child: Material(
        color: IronshelfColors.surface.withValues(alpha: 0.95),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              Expanded(
                child: LinearProgressIndicator(
                  value: _progress.clamp(0.0, 1.0),
                  backgroundColor: IronshelfColors.surfaceVariant,
                ),
              ),
              const SizedBox(width: 12),
              Text('${(_progress * 100).round()}%'),
            ],
          ),
        ),
      ),
    );
  }
}
