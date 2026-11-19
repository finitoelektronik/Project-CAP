using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

internal static class CAPLauncher
{
    [STAThread]
    private static void Main()
    {
        try
        {
            string root = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            bool restart = Path.GetFileNameWithoutExtension(Assembly.GetExecutingAssembly().Location)
                .StartsWith("Restart", StringComparison.OrdinalIgnoreCase);
            string script = Path.Combine(root, restart ? "Restart-CAP-Analytics.cmd" : "Start-CAP-Analytics.ps1");
            if (!File.Exists(script)) throw new FileNotFoundException("File peluncur CAP tidak ditemukan.", script);

            ProcessStartInfo process = new ProcessStartInfo();
            if (restart)
            {
                process.FileName = Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe";
                process.Arguments = "/c \"" + script + "\"";
            }
            else
            {
                process.FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32\\WindowsPowerShell\\v1.0\\powershell.exe");
                process.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"";
            }
            process.WorkingDirectory = root;
            process.UseShellExecute = false;
            process.CreateNoWindow = true;
            Process.Start(process);
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "CAP Analytics", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
