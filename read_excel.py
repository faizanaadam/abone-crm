import sys
import pandas as pd

sys.stdout.reconfigure(encoding='utf-8')

file_path = 'Abone_Bangalore_MASTER.xlsx'
try:
    xl = pd.ExcelFile(file_path)
    
    # Read first few rows of priority sheets
    for sheet in ['Bangalore Ortho Doctors', 'Zone Mapping Ready']:
        if sheet in xl.sheet_names:
            df = xl.parse(sheet, header=2, nrows=3)
            print(f"\n--- Sheet: {sheet} ---")
            print(f"Columns: {list(df.columns)}")
            for idx, row in df.iterrows():
                print(f"Row {idx}: {row.to_dict()}")
except Exception as e:
    print(f"Error reading file: {e}")
