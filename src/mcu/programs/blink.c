/*
 * Built-in "Blink" program for the Arduino Uno (ATmega328P at 16 MHz).
 *
 * Source of the hex embedded in blink.ts. It does what the Arduino Blink
 * sketch does, the way the Arduino core does it: Timer0 overflows every
 * 1.024 ms and an interrupt keeps millis() (same fraction trick as the
 * core), the LED on pin 13 (PB5) toggles every 1000 ms, and each change is
 * printed on the serial port at 9600 baud.
 * Written for Gatehouse (no Arduino core code is used).
 *
 * Build (WinAVR 20100110, avr-gcc 4.3.3):
 *   avr-gcc -mmcu=atmega328p -Os -DF_CPU=16000000UL -o blink.elf blink.c
 *   avr-objcopy -O ihex -R .eeprom blink.elf blink.hex
 */
#include <avr/io.h>
#include <avr/interrupt.h>

static volatile unsigned long timer0_millis;
static volatile unsigned char timer0_fract;

/* 64 * 256 / 16 MHz = 1024 us per overflow: 1 ms plus 3/125 ms. */
ISR(TIMER0_OVF_vect)
{
    unsigned long m = timer0_millis + 1;
    unsigned char f = timer0_fract + 3;
    if (f >= 125) {
        f -= 125;
        m += 1;
    }
    timer0_fract = f;
    timer0_millis = m;
}

static unsigned long millis(void)
{
    unsigned long m;
    unsigned char sreg = SREG;
    cli();
    m = timer0_millis;
    SREG = sreg;
    return m;
}

static void print(const char *s)
{
    while (*s) {
        while (!(UCSR0A & (1 << UDRE0))) {
        }
        UDR0 = *s++;
    }
}

/* Wait until millis() reaches `until` (wrap-safe), like delay() but without drift. */
static void wait_until(unsigned long until)
{
    while ((long)(millis() - until) < 0) {
    }
}

int main(void)
{
    /* Timer0 as the Arduino core sets it up: fast PWM, clock / 64, overflow interrupt. */
    TCCR0A = (1 << WGM01) | (1 << WGM00);
    TCCR0B = (1 << CS01) | (1 << CS00);
    TIMSK0 = (1 << TOIE0);
    /* Serial.begin(9600): UBRR = 16 MHz / (16 * 9600) - 1 = 103, 8N1, transmitter on. */
    UBRR0 = 103;
    UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);
    UCSR0B = (1 << TXEN0);
    /* pinMode(13, OUTPUT) */
    DDRB |= (1 << PB5);
    sei();

    print("Blink: LED on pin 13\r\n");
    unsigned long next = millis();
    for (;;) {
        PORTB |= (1 << PB5);
        print("LED on\r\n");
        next += 1000;
        wait_until(next);
        PORTB &= ~(1 << PB5);
        print("LED off\r\n");
        next += 1000;
        wait_until(next);
    }
}
