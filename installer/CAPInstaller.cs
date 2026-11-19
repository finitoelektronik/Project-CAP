using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

internal static class CAPInstaller
{
    [STAThread]
    private static void Main()
    {
        string work = Path.Combine(Path.GetTempPath(), "cap-analytics-install-" + Guid.NewGuid().ToString("N"));
        bool completed = false;
        try
        {
            Directory.CreateDirectory(work);
            string archive = Path.Combine(work, "payload.zip");
            Assembly assembly = Assembly.GetExecutingAssembly();
            using (Stream source = assembly.GetManifestResourceStream("CAPPayload"))
            {
                if (source == null) throw new InvalidOperationException("Payload installer tidak ditemukan.");
                using (FileStream destination = new FileStream(archive, FileMode.Create, FileAccess.Write)) source.CopyTo(destination);
            }
            ZipFile.ExtractToDirectory(archive, work);
            string installer = Path.Combine(work, "Install-CAP-Analytics.ps1");
            if (!File.Exists(installer)) throw new FileNotFoundException("Skrip instalasi CAP tidak lengkap.", installer);
            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32\\WindowsPowerShell\\v1.0\\powershell.exe");
            start.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + installer + "\" -StartAfterInstall -ForceUpdate";
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.RedirectStandardOutput = true;
            start.RedirectStandardError = true;
            using (Process process = Process.Start(start))
            {
                string output = process.StandardOutput.ReadToEnd();
                string errors = process.StandardError.ReadToEnd();
                process.WaitForExit();
                if (process.ExitCode != 0) throw new InvalidOperationException(output + Environment.NewLine + errors);
            }
            string installPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CAP Analytics");
            if (!File.Exists(Path.Combine(installPath, "app.mjs"))) throw new InvalidOperationException("Folder aplikasi tidak terbentuk.");
            completed = true;
            MessageBox.Show("CAP Analytics berhasil dipasang. Buka shortcut CAP Analytics di Desktop atau http://localhost:3100.\n\nUntuk akses dari perangkat LAN, jalankan Aktifkan-Akses-LAN.ps1 sebagai Administrator.", "CAP Analytics", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception error)
        {
            string log = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "CAP-Install.log");
            File.WriteAllText(log, error.ToString());
            MessageBox.Show("Instalasi belum berhasil. Detail error disimpan pada Desktop sebagai CAP-Install.log.", "CAP Analytics", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            if (completed) { try { Directory.Delete(work, true); } catch { } }
        }
    }
}
