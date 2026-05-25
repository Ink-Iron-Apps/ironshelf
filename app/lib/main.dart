// Ironshelf Flutter app — M0 scaffold (placeholder).
// See docs/ROADMAP.md (M4) for the real app: server connect (with custom headers
// for Cloudflare Access), Author -> Series -> Book browse, epub reader, settings.
//
// NOTE: this is a hand-written stub. In M4, generate the full Flutter project
// (`flutter create`) with org com.inknironapps and applicationId
// com.inknironapps.ironshelf, then layer this UI in.

import 'package:flutter/material.dart';

void main() => runApp(const IronshelfApp());

class IronshelfApp extends StatelessWidget {
  const IronshelfApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Ironshelf',
      theme: ThemeData(useMaterial3: true, brightness: Brightness.dark),
      home: const Scaffold(
        body: Center(child: Text('Ironshelf — scaffold')),
      ),
    );
  }
}
