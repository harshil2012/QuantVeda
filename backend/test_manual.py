from broker import fetch_max_candles_data

result = fetch_max_candles_data("RELIANCE.NS")
print("Symbol:", result["symbol"])
print("Count:", result["count"])
print("Range:", result["range"])
print("First candle:", result["candles"][0])
print("Last candle:", result["candles"][-1])

# Check if daily (timestamps ~86400 sec apart)
if len(result["candles"]) > 1:
    diffs = [result["candles"][i+1]["time"] - result["candles"][i]["time"] for i in range(min(10, len(result["candles"])-1))]
    avg_diff = sum(diffs) / len(diffs)
    print(f"Avg timestamp diff: {avg_diff} sec ({avg_diff/86400:.1f} days)")
    print("Data is daily:" , 0.8 < avg_diff/86400 < 1.5)