-- Rule R6 stores references with look-alike letters folded to digits, so a misread O or I still
-- finds the claimed reference.
UPDATE "payment_refs" SET "tx_ref" = translate(upper("tx_ref"), 'OI', '01');
