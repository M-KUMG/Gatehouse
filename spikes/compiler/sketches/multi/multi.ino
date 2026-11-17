#include "counter.h"
void setup() { Serial.begin(9600); pinMode(13, OUTPUT); greet(); }
void loop() {
  counterStep();
  Serial.println(describe(counterValue()));
  blinkTimes(1);
  delay(100);
}
