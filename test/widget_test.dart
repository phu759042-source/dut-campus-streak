import 'package:flutter_test/flutter_test.dart';
import 'package:dut_campus_streak/main.dart';

void main() {
  testWidgets('DUT Campus Streak app loads', (WidgetTester tester) async {
    await tester.pumpWidget(const DUTCampusStreakApp());

    expect(find.text('DUT Campus Streak'), findsOneWidget);
  });
}