import sqlite3
from datetime import datetime

def get_conky_output():
    conn = sqlite3.connect('/home/aqilserver/family_tree_app/family_tree.db')
    c = conn.cursor()
    
    c.execute("SELECT COUNT(*) FROM members")
    total = c.fetchone()[0]
    
    c.execute("SELECT COUNT(*) FROM members WHERE is_deceased = 0")
    alive = c.fetchone()[0]
    
    c.execute("SELECT COUNT(*) FROM members WHERE is_deceased = 1")
    deceased = c.fetchone()[0]
    
    # Upcoming birthdays
    c.execute("SELECT name, birth_date, is_deceased FROM members WHERE birth_date IS NOT NULL AND birth_date != ''")
    members = c.fetchall()
    
    today = datetime.now()
    upcoming = []
    for name, bdate_str, is_dec in members:
        if is_dec:
            continue
        try:
            bdate = datetime.strptime(bdate_str, '%Y-%m-%d')
            bday_this_year = bdate.replace(year=today.year)
            if bday_this_year.date() < today.date():
                bday_this_year = bday_this_year.replace(year=today.year + 1)
            
            days_until = (bday_this_year.date() - today.date()).days
            if 0 <= days_until <= 30:
                age_turning = bday_this_year.year - bdate.year
                # Format name nicely (capitalize each word, limit length)
                nice_name = " ".join([w.capitalize() for w in name.split()])
                if len(nice_name) > 20:
                    nice_name = nice_name[:17] + "..."
                upcoming.append((days_until, nice_name, age_turning))
        except:
            pass
            
    upcoming.sort(key=lambda x: x[0])
    
    output = f"FAMILY TREE STATS\n"
    output += f"${{hr}}\n"
    output += f"Total Members: {total}\n"
    output += f"Alive: {alive}  |  Deceased: {deceased}\n\n"
    
    output += f"UPCOMING BIRTHDAYS (Next 30 Days)\n"
    output += f"${{hr}}\n"
    if not upcoming:
        output += "No birthdays coming up soon.\n"
    else:
        for days, name, age in upcoming:
            if days == 0:
                output += f"${{color yellow}}TODAY! {name} turns {age}!${{color}}\n"
            else:
                output += f"In {days} days: {name} (turning {age})\n"
                
    conn.close()
    return output

if __name__ == "__main__":
    print(get_conky_output())
