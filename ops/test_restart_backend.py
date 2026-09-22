import subprocess
import sys
import unittest
from restart_backend import powershell


@unittest.skipUnless(sys.platform == 'win32', 'Windows operational entry')
class RestartEncodingTests(unittest.TestCase):
    def test_native_error_is_readable_instead_of_a_decoder_failure(self):
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            powershell("throw ([char]0x932F + [string][char]0x8AA4)")
        self.assertIsInstance(caught.exception.stderr, str)
        self.assertIn('\u932f\u8aa4', caught.exception.stderr)


if __name__ == '__main__':
    unittest.main()
