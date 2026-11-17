#include <SPI.h>
void setup() {
  Serial.begin(9600);
  pinMode(10, OUTPUT);
  SPI.begin();
  Serial.println("spi begin");
  digitalWrite(10, LOW);
  byte r = SPI.transfer(0xA5);
  digitalWrite(10, HIGH);
  Serial.print("transfer=");
  Serial.println(r);
}
void loop() {}
