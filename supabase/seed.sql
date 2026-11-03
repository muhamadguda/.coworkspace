-- Starter data for dot (rooms, modes, menu). Edit everything from the owner screens.
-- The owner setup code is set separately and never committed:
--   update public.app_setup set setup_code_hash = extensions.crypt('<CODE>', extensions.gen_salt('bf')) where id = 1;

insert into public.room_modes (name_ar, name_en, hourly_rate, sort) values
 ('بلايستيشن فردي', 'PlayStation single', 120, 1),
 ('بلايستيشن مالتي', 'PlayStation multiplayer', 150, 2),
 ('اجتماع / محاضرة', 'Meeting / lecture', 120, 3);

insert into public.places (kind, name_ar, name_en, sort) values
 ('room','أوضة ١','Room 1',1),('room','أوضة ٢','Room 2',2),('room','أوضة ٣','Room 3',3),
 ('table','ترابيزة ١','Table 1',1),('table','ترابيزة ٢','Table 2',2),('table','ترابيزة ٣','Table 3',3),
 ('table','ترابيزة ٤','Table 4',4),('table','ترابيزة ٥','Table 5',5),('table','ترابيزة ٦','Table 6',6);

with c as (
  insert into public.menu_categories (name_ar, name_en, sort) values
   ('مشروبات سخنة','Hot drinks',1),('مشروبات ساقعة','Cold drinks',2),('سناكس','Snacks',3),('حلويات','Desserts',4)
  returning id, name_en)
insert into public.menu_items (category_id, name_ar, name_en, desc_ar, desc_en, price, options, sort)
select c.id, v.name_ar, v.name_en, v.desc_ar, v.desc_en, v.price, v.options::jsonb, v.sort from c join (values
 ('Hot drinks','شاي','Tea','شاي كوباية','Classic black tea',20,'[{"id":"sugar","name_ar":"السكر","name_en":"Sugar","choices":[{"id":"none","name_ar":"من غير سكر","name_en":"No sugar"},{"id":"light","name_ar":"سكر خفيف","name_en":"Light"},{"id":"medium","name_ar":"مظبوط","name_en":"Medium"},{"id":"sweet","name_ar":"زيادة","name_en":"Sweet"}]}]',1),
 ('Hot drinks','قهوة تركي','Turkish coffee','','',35,'[{"id":"sugar","name_ar":"السكر","name_en":"Sugar","choices":[{"id":"none","name_ar":"سادة","name_en":"Plain"},{"id":"light","name_ar":"على الريحة","name_en":"Light"},{"id":"medium","name_ar":"مظبوط","name_en":"Medium"},{"id":"sweet","name_ar":"زيادة","name_en":"Sweet"}]}]',2),
 ('Hot drinks','إسبريسو','Espresso','','',40,'[]',3),
 ('Hot drinks','كابتشينو','Cappuccino','','',60,'[{"id":"milk","name_ar":"اللبن","name_en":"Milk","choices":[{"id":"full","name_ar":"كامل الدسم","name_en":"Full fat"},{"id":"skim","name_ar":"خالي الدسم","name_en":"Skimmed"},{"id":"oat","name_ar":"شوفان","name_en":"Oat"}]}]',4),
 ('Hot drinks','لاتيه','Latte','','',65,'[{"id":"milk","name_ar":"اللبن","name_en":"Milk","choices":[{"id":"full","name_ar":"كامل الدسم","name_en":"Full fat"},{"id":"skim","name_ar":"خالي الدسم","name_en":"Skimmed"},{"id":"oat","name_ar":"شوفان","name_en":"Oat"}]}]',5),
 ('Hot drinks','هوت شوكليت','Hot chocolate','','',60,'[]',6),
 ('Cold drinks','آيس لاتيه','Iced latte','','',70,'[]',1),
 ('Cold drinks','سبانيش لاتيه مثلج','Iced Spanish latte','','',75,'[]',2),
 ('Cold drinks','ليمون نعناع','Lemon mint','','',45,'[]',3),
 ('Cold drinks','مياه معدنية','Water','','',15,'[]',4),
 ('Cold drinks','كانز','Soft drink','','',30,'[]',5),
 ('Snacks','كرواسون زبدة','Butter croissant','','',45,'[]',1),
 ('Snacks','ساندوتش جبنة رومي','Roumi cheese sandwich','','',55,'[]',2),
 ('Snacks','شيبسي','Chips','','',20,'[]',3),
 ('Desserts','براوني','Brownie','','',50,'[]',1),
 ('Desserts','تشيز كيك','Cheesecake','','',70,'[]',2)
) as v(cat, name_ar, name_en, desc_ar, desc_en, price, options, sort) on v.cat = c.name_en;
