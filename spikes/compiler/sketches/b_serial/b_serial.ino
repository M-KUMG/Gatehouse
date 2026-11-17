int n = 0;
void setup() { Serial.begin(9600); }
void loop() { Serial.print("tick "); Serial.println(n++); delay(500); }
