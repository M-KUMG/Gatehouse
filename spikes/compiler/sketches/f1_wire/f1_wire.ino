#include <Wire.h>
void setup() {
  Serial.begin(9600);
  Wire.begin();
  Serial.println("wire begin");
  Wire.beginTransmission(0x3C);
  Wire.write(0x00);
  byte err = Wire.endTransmission();
  Serial.print("endTransmission=");
  Serial.println(err);
}
void loop() { digitalWrite(13, !digitalRead(13)); delay(200); }
