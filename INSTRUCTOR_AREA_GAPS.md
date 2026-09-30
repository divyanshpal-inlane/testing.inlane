# Instructor service areas — who location search cannot reach

Generated 2026-09-29 · live DB + `public/instructors.kml`

Instructors: **130** · with a drawn polygon (location-findable): **67** · without: **63**

| Group                                    | Count | Of those active | Meaning                                           |
| ---------------------------------------- | ----- | --------------- | ------------------------------------------------- |
| 1a. No polygon, but had a KML placemark  | 3     | 0               | Was findable before, is not now — **regression**  |
| 1b. No polygon, no KML placemark         | 60    | 7               | Never findable by location, before or after       |
| 2. Has a polygon, but KML pin outside it | 12    | 9               | Findable, but only strictly inside the drawn line |

## Group 1a — REGRESSION: no polygon, KML had a pin (3)

The old 3 km proximity fallback could surface these; polygon-only cannot. 3 of 3 are inactive/disabled, so they are not bookable anyway.

| Instructor           | Status              | KML pin          | Legacy areas           | Radius | Phone      |
| -------------------- | ------------------- | ---------------- | ---------------------- | ------ | ---------- |
| **Nadeem Ar **       | inactive + disabled | 13.0591, 77.5488 | jalahalli              | 8      | 9538962522 |
| **Nageshwar Sharma** | inactive + disabled | 13.0515, 77.5774 | Yeswanthpur, jalahalli | 7      | 7022366263 |
| **Rohith BR **       | inactive + disabled | 12.9937, 77.5543 | rajajinagar            | 7      | 9986188056 |

## Group 1b — No polygon and no KML placemark (60)

Never reachable by location, before or after. Not a regression. **53 of 60 are inactive/disabled.**

### Active but not location-findable (7) — review these

| Instructor                         | Status | Legacy areas                                          | Radius | Phone         | Address                                                      |
| ---------------------------------- | ------ | ----------------------------------------------------- | ------ | ------------- | ------------------------------------------------------------ |
| **Amanulla Khan**                  | active | hsr                                                   | 7      | 9538399666    | BHEL Layout, SR Krishnappa Garden, Jayanagar, Bengaluru, Kar |
| **ankit_ins**                      | active | Ayyappa Nagar, Amrita nagar, choodasandra, ambalipura | 8      | 8951601382    | Madiwala New Extension, HSR layout Sector 2, 1st Stage, BTM  |
| **Hidayat**                        | active | —                                                     | —      | +917006342430 | —                                                            |
| **Krupakar Daniel Dennish**        | active | Indiranagar                                           | 8      | 8197070409    | Indiranagar, Bengaluru, Karnataka, India                     |
| **Priyanka Jain (test)**           | active | HSR Layout                                            | 10     | 9886666824    | HSR BDA Complex, 14th Main Rd, Sector 6, HSR Layout, Bengalu |
| **test_ins_hidayat_dont_delete**   | active | Adugodi, aavalahalli, Abbigere                        | 7      | 9103181291    | HSR BDA Complex, 14th Main Rd, Sector 6, HSR Layout, Bengalu |
| **test-instr-latehrs_dont_delete** | active | Jp nagar                                              | 10     | 5846298310    | j p nagar, park, 5, 17th Cross Rd, 5th Phase, J P Nagar Phas |

### Inactive/disabled (53) — expected, no action

| Instructor                 | Status              | Legacy areas                               | Radius | Phone      |
| -------------------------- | ------------------- | ------------------------------------------ | ------ | ---------- |
| Akash                      | inactive + disabled | Jakkur, RK Hedge Nagar, Kogilu             | 8      | 8072805689 |
| Albee josewin              | inactive + disabled | murgeshpalya                               | 7      | 8951138753 |
| ANAND KUMAR MP             | inactive + disabled | Jp nagar                                   | 8      | 9986700187 |
| Ankit_ins_test             | on_break            | Amrita nagar, choodasandra, Ayyappa Nagar  | 7      | 9438046117 |
| Bhimaraya Sir              | inactive + disabled | channasandra, uttarahalli                  | 8      | 9731191183 |
| Deependra Murthy TS (Eaby) | inactive + disabled | Koramangala, HSR Layout                    | 8      | 9048865039 |
| Gousmodin                  | inactive + disabled | Koramangala                                | 7      | 9019095547 |
| Hari/Janeesh               | inactive + disabled | HSR Layout, choodasandra, sarjapur road    | 8      | 9526592888 |
| Janardhana Sir             | inactive + disabled | Electronic city                            | 8      | 9606318536 |
| John Bosco                 | inactive + disabled | thanisandra                                | 7      | 9880911652 |
| K Nanda Gopal              | inactive + disabled | Krishnarajpuram, hoodi, Mahadevpura        | 8      | 6361077379 |
| Karthik                    | inactive + disabled | banashankari                               | 8      | 9164211777 |
| Kauser ahmed               | inactive + disabled | RT Nagar                                   | 7      | 8892101238 |
| keerthan                   | inactive + disabled | Electronic city                            | 9      | 9606047900 |
| Kishor S                   | inactive + disabled | Jp nagar                                   | 6      | 7019364957 |
| Lane                       | inactive + disabled | HSR Layout                                 | 7      | 9593645678 |
| Lesley deva                | inactive + disabled | horamavu                                   | 7      | 9739504279 |
| Mahantesh Bhuyar           | inactive + disabled | marathalli, Brookefield                    | 6      | 6360661234 |
| Manjunath R                | inactive + disabled | Yelahanka, aavalahalli                     | 8      | 8618511567 |
| Manoj                      | inactive + disabled | kengeri                                    | 8      | 8217581218 |
| Manoj Kumar D N            | inactive + disabled | Hennur                                     | 7      | 9108297966 |
| Marydas Jerson lazar       | inactive + disabled | Electronic City Phase I                    | 7      | 9474200966 |
| Mithun Sir                 | inactive + disabled | Yelahanka                                  | 9      | 8217787181 |
| Mohammed Ammar             | inactive + disabled | Hulimavu                                   | 7      | 9538865020 |
| Mohammed Haseeb            | inactive + disabled | Whitefield                                 | 7      | 8152053548 |
| Mohammed Ilyaz             | inactive + disabled | shanti nagar, Frazer Town                  | 7      | 9742427003 |
| Moin Khan                  | inactive + disabled | Koramangala                                | 8      | 8088533126 |
| Mubarak Sir                | inactive + disabled | Indiranagar, RT Nagar                      | 10     | 9886790206 |
| Munawar Ahamed             | inactive + disabled | Jayanagar, Jp nagar                        | 9      | 9141669607 |
| Murali M                   | inactive + disabled | nagarbhavi, ullal                          | 8      | 8550899697 |
| Narendra sir               | inactive + disabled | mathikere                                  | 8      | 8792975535 |
| Naveen                     | inactive + disabled | basaveshwar nagar, Majestic                | 7      | 9480585315 |
| Naveen kumar r             | inactive + disabled | banashankari                               | 7      | 6363113830 |
| Nitheesh Reddy             | inactive + disabled | Yeshwanthpur, Laggere                      | 7      | 9963932158 |
| Nooruddin Siraj            | inactive + disabled | Indiranagar                                | 7      | 9108853748 |
| Parth Chandravadiya (test) | inactive + disabled | Indiranagar                                | 10     | 9313100852 |
| Poornim Kumar              | inactive + disabled | Hegadur, Whitefield                        | 7      | 9886165528 |
| Prasad                     | inactive + disabled | Whitefield                                 | 8      | 9538948885 |
| Rajesh Sir                 | inactive + disabled | Horamavu, Hennur                           | 6      | 9742751797 |
| Ramu j                     | inactive + disabled | Krishnarajpuram                            | 7      | 9731531219 |
| Richard Samson             | inactive + disabled | Electronic city                            | 8      | 9148538056 |
| Richard Sir                | inactive + disabled | bommanahalli, HSR Layout                   | 7      | 7975660619 |
| Rizwan ahmed               | inactive + disabled | Indiranagar, Halasuru, Cox Town            | 10     | 9632072196 |
| Salman sir                 | inactive + disabled | Indiranagar                                | 8      | 8125875040 |
| Shakir sir                 | inactive + disabled | JC nagar                                   | 8      | 8970097739 |
| Shashidhara RN             | inactive + disabled | ram murthy nagar, Krishnarajpuram          | 7      | 9880960162 |
| Shrinidhi S Srivatsav      | inactive + disabled | Jp nagar                                   | 9      | 8310628692 |
| Somappa Lamani             | inactive + disabled | aavalahalli, cheemasandra, chikkabanahalli | 6      | 9980009541 |
| Somnath das sir            | inactive + disabled | Indiranagar                                | 7      | 7699560051 |
| Syed mansoor               | inactive + disabled | Frazer Town, hbr layout                    | 7      | 7892230637 |
| Titus Dammu                | inactive + disabled | kudlu, HSR Layout                          | 7      | 7353397117 |
| Vaibhav                    | inactive + disabled | banashankari, kumarswamy layout            | 8      | 7899161899 |
| Vijay Kumar M              | inactive + disabled | horamavu                                   | 9      | 9019029955 |

## Group 2 — Has a polygon, but the KML pin sits OUTSIDE it (12)

These **are** findable — only inside their drawn boundary. Listed because the field team's mental model is the pin, so "can't find him" reports usually mean the pin falls outside the drawing. Moving the vertex, not adding an instructor, is the fix.

| Instructor        | Status   | Pin to polygon | Pin              | Polygon bbox lat / lng        | Legacy areas                  | Radius | Phone      |
| ----------------- | -------- | -------------- | ---------------- | ----------------------------- | ----------------------------- | ------ | ---------- |
| **Santhosh**      | on_break | 10.8 km        | 12.9996, 77.4959 | 12.898–12.943 / 77.568–77.613 | BTM Layout, Jp nagar          | 7      | 8970883416 |
| **Adnan Shama**   | on_break | 4.4 km         | 13.0204, 77.6340 | 12.976–13.000 / 77.664–77.693 | CV Raman Nagar                | 7      | 7676735572 |
| **Anas**          | active   | 3.3 km         | 12.9850, 77.6077 | 12.947–12.990 / 77.634–77.681 | Indiranagar                   | 7      | 9380914542 |
| **Yuvaraj M**     | active   | 2.6 km         | 12.9141, 77.6376 | 12.913–12.950 / 77.660–77.707 | bellandur                     | 7      | 9844475543 |
| **Vinod Kumar**   | active   | 2.3 km         | 12.7986, 77.7070 | 12.816–12.866 / 77.666–77.716 | Electronic City phase 2       | 7      | 9663004959 |
| **BABAJAN N **    | on_break | 2.2 km         | 13.0015, 77.6838 | 12.949–12.996 / 77.693–77.728 | ITPL, hoodi, Krishnarajapuram | 7      | 9731241547 |
| **A Sagar Rao**   | active   | 1.3 km         | 12.9258, 77.5199 | 12.904–12.934 / 77.531–77.567 | banashankari, uttarahalli     | 7      | 7892572051 |
| **Chandan SK **   | active   | 0.6 km         | 12.9247, 77.4985 | 12.925–12.966 / 77.469–77.525 | kengeri                       | 7      | 9986833557 |
| **Basavaling SH** | active   | 0.5 km         | 12.9953, 77.5659 | 12.954–13.000 / 77.568–77.625 | shanti nagar                  | 8      | 7353133384 |
| **Arun M**        | active   | 0.5 km         | 12.8478, 77.5781 | 12.851–12.880 / 77.569–77.610 | Jp nagar                      | 7      | 9901594001 |
| **Harish P**      | active   | 0.4 km         | 12.9146, 77.7663 | 12.912–12.945 / 77.716–77.769 | Sarjapura, sarjapur road      | 7      | 9916607307 |
| **K Santosh**     | active   | 0.4 km         | 12.9671, 77.7605 | 12.967–13.012 / 77.728–77.771 | Whitefield                    | 8      | 6303929972 |
