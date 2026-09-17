$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add('http://localhost:5173/')
$listener.Start()
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$mimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
}

Write-Host 'Relay is running at http://localhost:5173'
Write-Host 'Press Ctrl+C to stop.'

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $relativePath = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath)
    if ($relativePath -eq '/') { $relativePath = '/index.html' }
    $filePath = Join-Path $root $relativePath.TrimStart('/')
    $resolvedPath = [System.IO.Path]::GetFullPath($filePath)

    if (-not $resolvedPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $resolvedPath -PathType Leaf)) {
      $context.Response.StatusCode = 404
      $bytes = [Text.Encoding]::UTF8.GetBytes('Not found')
    } else {
      $extension = [System.IO.Path]::GetExtension($resolvedPath).ToLowerInvariant()
      $context.Response.ContentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { 'application/octet-stream' }
      $context.Response.Headers.Add('Cache-Control', 'no-store')
      $bytes = [IO.File]::ReadAllBytes($resolvedPath)
    }

    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.Close()
  }
} finally {
  $listener.Stop()
}
