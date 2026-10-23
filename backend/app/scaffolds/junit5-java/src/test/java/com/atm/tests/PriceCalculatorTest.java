package com.atm.tests;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class PriceCalculatorTest {

    @ParameterizedTest(name = "{0} + {1}% VAT = {2}")
    @CsvSource({"100.00, 19, 119.00", "10.50, 9, 11.45", "0, 19, 0.00"})
    void addsVat(String net, int vat, String expected) {
        assertEquals(new BigDecimal(expected), PriceCalculator.withVat(new BigDecimal(net), vat));
    }

    @Test
    @DisplayName("rejects negative prices")
    void rejectsNegativePrices() {
        assertThrows(IllegalArgumentException.class, () -> PriceCalculator.withVat(new BigDecimal("-1"), 19));
    }
}
