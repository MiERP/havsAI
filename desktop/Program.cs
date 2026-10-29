using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Windows.Forms;

[assembly: AssemblyTitle("havsAI Desktop")]
[assembly: AssemblyDescription("havsAI Multi-Device AI Tutor Desktop Application")]
[assembly: AssemblyCompany("havsAI")]
[assembly: AssemblyProduct("havsAI Desktop")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace HavsAI.Desktop
{
    internal static class Program
    {
        private const string DefaultServerUrl = "https://103-20-102-229.sslip.io";
        private const string FallbackServerUrl = "http://localhost:3000";

        [STAThread]
        private static int Main(string[] args)
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            string serverUrl = ResolveServerUrl(args);
            string route = ResolveRoute(args);
            bool checkOnly = false;

            foreach (string arg in args)
            {
                if (string.Equals(arg, "--check", StringComparison.OrdinalIgnoreCase))
                {
                    checkOnly = true;
                }
            }

            string targetBase = serverUrl;
            if (!CheckServerHealth(targetBase) && CheckServerHealth(FallbackServerUrl))
            {
                targetBase = FallbackServerUrl;
            }

            if (checkOnly)
            {
                Console.WriteLine("{\"ok\":true,\"app\":\"havsAI-Desktop\",\"serverUrl\":\"" + targetBase + "\"}");
                return 0;
            }

            string launchUrl = targetBase.TrimEnd('/') + "/" + route.TrimStart('/');
            if (!LaunchChromiumAppWindow(launchUrl))
            {
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = launchUrl,
                        UseShellExecute = true
                    });
                }
                catch (Exception ex)
                {
                    MessageBox.Show(
                        "Không thể mở kết nối tới máy chủ havsAI (" + launchUrl + "):\n" + ex.Message,
                        "havsAI Desktop",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                    return 1;
                }
            }
            return 0;
        }

        private static string ResolveServerUrl(string[] args)
        {
            foreach (string arg in args)
            {
                if (arg.StartsWith("--server=", StringComparison.OrdinalIgnoreCase))
                {
                    return arg.Substring("--server=".Length).Trim().TrimEnd('/');
                }
            }

            string envUrl = Environment.GetEnvironmentVariable("HAVS_SERVER_URL");
            if (!string.IsNullOrWhiteSpace(envUrl))
            {
                return envUrl.Trim().TrimEnd('/');
            }

            try
            {
                string exeDir = AppDomain.CurrentDomain.BaseDirectory;
                string configFile = Path.Combine(exeDir, "config.json");
                if (File.Exists(configFile))
                {
                    string json = File.ReadAllText(configFile);
                    Match m = Regex.Match(json, "\"serverUrl\"\\s*:\\s*\"([^\"]+)\"");
                    if (m.Success && !string.IsNullOrWhiteSpace(m.Groups[1].Value))
                    {
                        return m.Groups[1].Value.Trim().TrimEnd('/');
                    }
                }
            }
            catch
            {
            }

            return DefaultServerUrl;
        }

        private static string ResolveRoute(string[] args)
        {
            foreach (string arg in args)
            {
                if (arg.StartsWith("--route=", StringComparison.OrdinalIgnoreCase))
                {
                    return arg.Substring("--route=".Length).Trim();
                }
            }
            return "";
        }

        private static bool CheckServerHealth(string baseUrl)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(baseUrl.TrimEnd('/') + "/api/health");
                req.Method = "GET";
                req.Timeout = 3500;
                req.ReadWriteTimeout = 3500;
                req.UserAgent = "havsAI-Desktop/1.0";
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    return (int)res.StatusCode >= 200 && (int)res.StatusCode < 400;
                }
            }
            catch
            {
                return false;
            }
        }

        private static bool LaunchChromiumAppWindow(string url)
        {
            string[] candidates = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft\\Edge\\Application\\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google\\Chrome\\Application\\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google\\Chrome\\Application\\chrome.exe")
            };

            string profileDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "havsAI",
                "DesktopProfile"
            );

            try
            {
                Directory.CreateDirectory(profileDir);
            }
            catch
            {
            }

            foreach (string browserPath in candidates)
            {
                if (!File.Exists(browserPath)) continue;
                try
                {
                    string arguments = string.Format(
                        "--app=\"{0}\" --user-data-dir=\"{1}\" --window-size=1360,860 --no-first-run --no-default-browser-check",
                        url,
                        profileDir
                    );
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = browserPath,
                        Arguments = arguments,
                        UseShellExecute = false
                    });
                    return true;
                }
                catch
                {
                }
            }
            return false;
        }
    }
}
