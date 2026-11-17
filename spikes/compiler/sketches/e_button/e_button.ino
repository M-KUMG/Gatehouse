volatile unsigned int presses = 0;
unsigned int shown = 0;
void setup() {
  Serial.begin(9600);
  pinMode(2, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(2), onPress, FALLING);
  Serial.println("ready");
}
void loop() {
  if (presses != shown) { shown = presses; report(shown); }
}
void report(unsigned int n) { Serial.print("presses="); Serial.println(n); }
void onPress() { presses++; }
