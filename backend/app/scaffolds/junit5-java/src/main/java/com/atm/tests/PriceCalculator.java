package com.atm.tests;

import java.math.BigDecimal;
import java.math.RoundingMode;

/** Sample code under test. Replace it with (or point your tests at) your own application code. */
public final class PriceCalculator {
    private PriceCalculator() {
    }

    public static BigDecimal withVat(BigDecimal net, int vatPercent) {
        if (net == null || net.signum() < 0) {
            throw new IllegalArgumentException("Net price must be zero or positive");
        }
        BigDecimal factor = BigDecimal.ONE.add(BigDecimal.valueOf(vatPercent).movePointLeft(2));
        return net.multiply(factor).setScale(2, RoundingMode.HALF_UP);
    }
}
