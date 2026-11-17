
ISR(TIMER1_COMPA_vect) { PINB = _BV(5); }
void setup() { pinMode(13, OUTPUT); TCCR1A = 0; TCCR1B = _BV(WGM12) | _BV(CS12); OCR1A = 31249; TIMSK1 = _BV(OCIE1A); }
void loop() {}
