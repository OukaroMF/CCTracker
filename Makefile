# SPDX-FileCopyrightText: 2026 OukaroMF
# SPDX-License-Identifier: GPL-3.0-or-later

.PHONY: build test clean

build:
	mkdir -p build
	cd extension && python3 -m zipfile -c ../build/cctracker-extension.zip * ../LICENSE ../THIRD_PARTY_NOTICES.md ../PRIVACY.md
	cd build && sha256sum cctracker-extension.zip > SHA256SUMS

test:
	node --test --test-isolation=none tests/*.test.mjs

clean:
	rm -rf build
