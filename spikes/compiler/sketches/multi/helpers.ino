void greet() { Serial.println(F("multi-file sketch")); }
void blinkTimes(int n) { for (int i = 0; i < n; i++) { digitalWrite(13, HIGH); delay(50); digitalWrite(13, LOW); delay(50); } }
